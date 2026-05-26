"""
MVUM Layer 3b: OSM parking as multi-modal Auto transition candidates.

Loads ``/mnt/nav/osm-parking.db`` (amenity=parking objects ingested from the
geofabrik North America extract) into a shapely STRtree of parking points, so Auto
can suggest "drive to a parking lot, switch to foot/2w/4w" trips where no MVUM
trailhead exists — BLM/state land, urban edges, anywhere OSM has parking but the
USFS trailhead layer does not. Read-only, pure spatial lookup; mirrors the
MVUMSpatialIndex (Layer 0) / TrailheadIndex (Layer 3a) singleton pattern.

Coordinates are stored in packed numpy arrays and the per-feature attribute columns
as plain lists; the shapely Point objects exist only long enough to build the
STRtree and are then released. Candidate record dicts are constructed lazily in
query_parking_near_line. This keeps RSS to a few hundred MB for ~1.5M rows instead
of ~1 GB of per-row dicts + Point objects.
"""
import logging
import os
import sqlite3
import sys
import time as _time
from pathlib import Path

import numpy as np
import psutil
from shapely.geometry import Point, LineString
from shapely.strtree import STRtree

from .mvum import _buffer_degrees_for_meters

logger = logging.getLogger("navi_offroute.mvum_parking")

DEFAULT_PARKING_DB = Path("/mnt/nav/osm-parking.db")

# Parking that is off-limits as a public transition point.
_BLOCKED_ACCESS = frozenset({"private", "no", "permit"})


def parking_db_path() -> Path:
    """osm-parking.db path, env-overridable via NAVI_OFFROUTE_PARKING_DB."""
    return Path(os.environ.get("NAVI_OFFROUTE_PARKING_DB", str(DEFAULT_PARKING_DB)))


class OSMParkingIndex:
    """In-memory STRtree over OSM parking points from osm-parking.db.

    Storage is columnar: ``_lats``/``_lons`` (float64 numpy arrays) plus
    ``_names``/``_parking_types``/``_accesses`` (lists, aligned by index).
    ``road_class`` is the constant ``"parking"`` so it is not stored per row.
    query_parking_near_line() builds the ``{lat, lon, name, road_class,
    parking_type, access}`` record dicts lazily from these columns.
    """

    def __init__(self, db_path=None):
        t0 = _time.perf_counter()
        proc = psutil.Process()
        rss_before = proc.memory_info().rss

        self.db_path = Path(db_path) if db_path else parking_db_path()
        lats, lons = [], []
        self._names, self._parking_types, self._accesses = [], [], []
        skipped_access = 0

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.execute(
                "SELECT name, capacity, access, parking_type, lat, lon FROM parking")
            for row in cur:
                access = row["access"]
                if access in _BLOCKED_ACCESS:
                    skipped_access += 1
                    continue
                lat, lon = row["lat"], row["lon"]
                if lat is None or lon is None:
                    continue
                # The ingest already stored representative_point() (an interior point
                # of each parking polygon) in the lat/lon columns, so the STRtree is
                # built straight from them -- parsing the 1.5M WKB shape blobs here
                # would add minutes to every worker boot for an identical point.
                lats.append(float(lat))
                lons.append(float(lon))
                self._names.append(row["name"] or "")
                # intern the small-cardinality attribute strings so duplicate values
                # share one object instead of 1.5M separate ones.
                pt = row["parking_type"]
                self._parking_types.append(sys.intern(pt) if isinstance(pt, str) else pt)
                self._accesses.append(sys.intern(access) if isinstance(access, str) else access)
        finally:
            conn.close()

        self._lats = np.asarray(lats, dtype=np.float64)
        self._lons = np.asarray(lons, dtype=np.float64)

        # Build the STRtree from transient Point objects, then release them; the tree
        # internalizes its own geometry storage and we reconstruct points on demand.
        points = [Point(lon, lat) for lon, lat in zip(lons, lats)]
        self._tree = STRtree(points) if points else None
        del points

        self.count = len(self._lats)
        self.skipped_access = skipped_access
        self.build_time_seconds = _time.perf_counter() - t0
        self.memory_estimate_mb = max(
            0.0, (proc.memory_info().rss - rss_before) / (1024 * 1024))
        logger.info(
            "OSM parking index loaded: %d parking objects (%d access-blocked skipped) "
            "in %.2f seconds", self.count, skipped_access, self.build_time_seconds)

    def _record(self, i):
        """Construct a candidate record dict for column index ``i``."""
        return {
            "lat": float(self._lats[i]),
            "lon": float(self._lons[i]),
            "name": self._names[i],
            "road_class": "parking",
            "parking_type": self._parking_types[i],
            "access": self._accesses[i],
        }

    @property
    def records(self):
        """All records, built lazily (used by tests / introspection — not the hot path)."""
        return [self._record(i) for i in range(self.count)]

    def query_parking_near_line(self, coords, buffer_m=2000):
        """Parking records within ~``buffer_m`` of a (lat, lon) polyline.

        Coarse STRtree bbox prefilter then a precise degree-distance check, matching
        TrailheadIndex.query_trailheads_near_line.
        """
        if not coords or self._tree is None:
            return []
        pts = [(lon, lat) for (lat, lon) in coords]
        geom = LineString(pts) if len(pts) >= 2 else Point(pts[0])
        avg_lat = sum(lat for (lat, lon) in coords) / len(coords)
        buffer_deg = _buffer_degrees_for_meters(buffer_m, avg_lat)
        out = []
        for i in self._tree.query(geom.buffer(buffer_deg)):
            if geom.distance(Point(self._lons[i], self._lats[i])) <= buffer_deg:
                out.append(self._record(i))
        return out


# Process-wide singleton, mirroring app.py's _MVUM_INDEX / trailhead handling.
_PARKING_INDEX = None


def load_parking_index(db_path=None):
    """Return the process-wide OSMParkingIndex singleton, building it on first call."""
    global _PARKING_INDEX
    if _PARKING_INDEX is None:
        _PARKING_INDEX = OSMParkingIndex(db_path)
    return _PARKING_INDEX
