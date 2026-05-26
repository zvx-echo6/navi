"""
MVUM Layer 3a: trailhead transition index for multi-modal Auto routing.

Loads the ``trail_entry_points`` table from navi.db into a shapely STRtree of
trailhead points and supports finding the trailheads near a route polyline. This
is pure spatial lookup — no routing logic — mirroring the MVUMSpatialIndex
(Layer 0) pattern: built once per process as a singleton via load_trailheads().

The router (``_route_auto``) uses these points as drive->offroad transition
candidates: a hybrid "drive to a trailhead, switch vehicles, continue offroad"
plan is considered when it beats the single-mode winner by a comfortable margin.

Coordinates are stored in packed numpy arrays and the attribute columns as plain
(interned) lists; the shapely Point objects exist only long enough to build the
STRtree and are then released. Record dicts are reconstructed lazily in
query_trailheads_near_line — same memory-pack pattern as OSMParkingIndex.
"""
import logging
import sqlite3
import sys
import time as _time
from pathlib import Path

import numpy as np
import psutil
from shapely.geometry import Point, LineString
from shapely.strtree import STRtree

from .mvum import navi_db_path, _buffer_degrees_for_meters

logger = logging.getLogger("navi_offroute.mvum_transitions")


class TrailheadIndex:
    """In-memory STRtree over ``trail_entry_points`` (trailhead/road access points).

    Storage is columnar: ``_lats``/``_lons`` (float64 numpy arrays) plus
    ``_names``/``_road_classes`` (lists, aligned by index). query_trailheads_near_line()
    builds the ``{lat, lon, name, road_class}`` record dicts lazily from these columns.
    (The DB column is ``highway_class``; it is surfaced as ``road_class`` for
    consistency with the entry-point records the router already emits.)
    """

    def __init__(self, db_path=None):
        t0 = _time.perf_counter()
        proc = psutil.Process()
        rss_before = proc.memory_info().rss

        self.db_path = Path(db_path) if db_path else navi_db_path()
        lats, lons = [], []
        self._names, self._road_classes = [], []

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.execute(
                "SELECT lat, lon, name, highway_class FROM trail_entry_points "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL"
            )
            for row in cur:
                lats.append(float(row["lat"]))
                lons.append(float(row["lon"]))
                self._names.append(row["name"] or "")
                # intern the small-cardinality road-class strings so duplicate values
                # share one object instead of ~740k separate ones.
                rc = row["highway_class"] or ""
                self._road_classes.append(sys.intern(rc))
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
        self.build_time_seconds = _time.perf_counter() - t0
        self.memory_estimate_mb = max(
            0.0, (proc.memory_info().rss - rss_before) / (1024 * 1024))
        logger.info(
            "Trailhead index loaded: %d entry points in %.2f seconds",
            self.count, self.build_time_seconds,
        )

    def _record(self, i):
        """Construct a trailhead record dict for column index ``i``."""
        return {
            "lat": float(self._lats[i]),
            "lon": float(self._lons[i]),
            "name": self._names[i],
            "road_class": self._road_classes[i],
        }

    @property
    def records(self):
        """All records, built lazily (used by tests / introspection — not the hot path)."""
        return [self._record(i) for i in range(self.count)]

    def query_trailheads_near_line(self, coords, buffer_m=2000):
        """Trailhead records within ~``buffer_m`` of a (lat, lon) polyline.

        Coarse STRtree bbox prefilter followed by a precise degree-distance check
        so only points genuinely close to the line are returned (the bbox alone
        would admit corner points up to ~1.4x buffer away).
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


# Process-wide singleton, mirroring app.py's _MVUM_INDEX handling.
_TRAILHEAD_INDEX = None


def load_trailheads(db_path=None):
    """Return the process-wide TrailheadIndex singleton, building it on first call."""
    global _TRAILHEAD_INDEX
    if _TRAILHEAD_INDEX is None:
        _TRAILHEAD_INDEX = TrailheadIndex(db_path)
    return _TRAILHEAD_INDEX
