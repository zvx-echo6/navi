"""
MVUM Layer 3a: trailhead transition index for multi-modal Auto routing.

Loads the ``trail_entry_points`` table from navi.db into a shapely STRtree of
trailhead points and supports finding the trailheads near a route polyline. This
is pure spatial lookup — no routing logic — mirroring the MVUMSpatialIndex
(Layer 0) pattern: built once per process as a singleton via load_trailheads().

The router (``_route_auto``) uses these points as drive->offroad transition
candidates: a hybrid "drive to a trailhead, switch vehicles, continue offroad"
plan is considered when it beats the single-mode winner by a comfortable margin.
"""
import logging
import sqlite3
import time as _time
from pathlib import Path

from shapely.geometry import Point, LineString
from shapely.strtree import STRtree

from .mvum import navi_db_path, _buffer_degrees_for_meters

logger = logging.getLogger("navi_offroute.mvum_transitions")


class TrailheadIndex:
    """In-memory STRtree over ``trail_entry_points`` (trailhead/road access points).

    Keeps the STRtree of point geometries plus a parallel ``records`` list of
    ``{lat, lon, name, road_class}`` dicts aligned with the tree's geometries.
    (The DB column is ``highway_class``; it is surfaced here as ``road_class`` for
    consistency with the entry-point records the router already emits.)
    """

    def __init__(self, db_path=None):
        t0 = _time.perf_counter()
        self.db_path = Path(db_path) if db_path else navi_db_path()
        self.records = []          # aligned with self._points
        self._points = []

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.execute(
                "SELECT lat, lon, name, highway_class FROM trail_entry_points "
                "WHERE lat IS NOT NULL AND lon IS NOT NULL"
            )
            for row in cur:
                lat = float(row["lat"])
                lon = float(row["lon"])
                self.records.append({
                    "lat": lat,
                    "lon": lon,
                    "name": row["name"] or "",
                    "road_class": row["highway_class"] or "",
                })
                self._points.append(Point(lon, lat))
        finally:
            conn.close()

        self._tree = STRtree(self._points) if self._points else None
        self.count = len(self.records)
        self.build_time_seconds = _time.perf_counter() - t0
        logger.info(
            "Trailhead index loaded: %d entry points in %.2f seconds",
            self.count, self.build_time_seconds,
        )

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
            if geom.distance(self._points[i]) <= buffer_deg:
                out.append(self.records[i])
        return out


# Process-wide singleton, mirroring app.py's _MVUM_INDEX handling.
_TRAILHEAD_INDEX = None


def load_trailheads(db_path=None):
    """Return the process-wide TrailheadIndex singleton, building it on first call."""
    global _TRAILHEAD_INDEX
    if _TRAILHEAD_INDEX is None:
        _TRAILHEAD_INDEX = TrailheadIndex(db_path)
    return _TRAILHEAD_INDEX
