"""
MVUM (Motor Vehicle Use Map) legal access layer for OFFROUTE.

Queries USFS MVUM data from navi.db and provides rasterized access grids
indicating which roads/trails are open or closed to specific vehicle modes.

MVUM is motor-vehicle specific — foot mode should skip this layer entirely.
"""
import logging
import math
import os
import re
import sqlite3
import threading
import time as _time
import warnings
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Literal

import numpy as np
import psutil
from shapely import wkb
from shapely.geometry import Point, LineString, box
from shapely.strtree import STRtree

# Path to navi.db (single source of truth); env-overridable.
DEFAULT_NAVI_DB_PATH = Path("/mnt/nav/navi.db")


def navi_db_path() -> Path:
    """navi.db (MVUM tables) path, env-overridable via NAVI_OFFROUTE_NAVI_DB."""
    return Path(os.environ.get("NAVI_OFFROUTE_NAVI_DB", str(DEFAULT_NAVI_DB_PATH)))


logger = logging.getLogger("navi_offroute.mvum_spatial")

def _buffer_degrees_for_meters(meters: float, lat: float) -> float:
    """Approximate buffer radius in degrees for a metre tolerance at a given latitude.
    Longitude degrees shrink with cos(lat); use the larger of the lat/lon equivalents so
    the bbox-coarse buffer stays conservative."""
    cos_lat = max(math.cos(math.radians(lat)), 0.01)
    lat_deg = meters / 111320.0
    lon_deg = meters / (111320.0 * cos_lat)
    return max(lat_deg, lon_deg)


class MVUMSpatialIndex:
    """In-memory STRtree over MVUM road + trail geometries from navi.db.

    Layer 0 of the MVUM/Valhalla spatial-join work: pure spatial lookup. It parses
    each row's WKB ``shape`` blob with shapely and indexes it in an STRtree, keeping a
    parallel list of full feature records (every column except the raw blob, plus the
    parsed ``geometry``). No routing logic and no response formats are touched.
    """

    def __init__(self, db_path=None):
        t0 = _time.perf_counter()
        proc = psutil.Process()
        rss_before = proc.memory_info().rss

        self.db_path = Path(db_path) if db_path else navi_db_path()
        self._records = []          # aligned with self._geoms
        self._geoms = []
        self.by_id = {}             # feature_id -> record (full-row lookup)
        self._min_lon = self._min_lat = float("inf")
        self._max_lon = self._max_lat = float("-inf")

        self.road_count = self._load_table("mvum_roads", "road")
        self.trail_count = self._load_table("mvum_trails", "trail")

        self._tree = STRtree(self._geoms) if self._geoms else None
        self.build_time_seconds = _time.perf_counter() - t0
        self.memory_estimate_mb = max(
            0.0, (proc.memory_info().rss - rss_before) / (1024 * 1024)
        )
        logger.info(
            "MVUM spatial index loaded: %d roads + %d trails in %.2f seconds",
            self.road_count, self.trail_count, self.build_time_seconds,
        )

    def _load_table(self, table, kind):
        count = 0
        parse_errors = 0
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            cur = conn.execute(f"SELECT * FROM {table} WHERE shape IS NOT NULL")
            cols = [c[0] for c in cur.description]
            for row in cur:
                try:
                    geom = wkb.loads(bytes(row["shape"]))
                except Exception:
                    parse_errors += 1
                    continue
                if geom.is_empty:
                    continue
                rec = {c: row[c] for c in cols if c != "shape"}
                rec["kind"] = kind
                rec["feature_id"] = f"{kind}:{row['ogc_fid']}"
                rec["geometry"] = geom
                self._records.append(rec)
                self._geoms.append(geom)
                self.by_id[rec["feature_id"]] = rec
                minx, miny, maxx, maxy = geom.bounds
                self._min_lon = min(self._min_lon, minx)
                self._min_lat = min(self._min_lat, miny)
                self._max_lon = max(self._max_lon, maxx)
                self._max_lat = max(self._max_lat, maxy)
                count += 1
        finally:
            conn.close()
        if parse_errors > 0:
            logger.warning("%s: %d rows had unparseable WKB shape blobs", table, parse_errors)
        return count

    @property
    def bbox(self):
        """Overall extent as [min_lon, min_lat, max_lon, max_lat]."""
        if not self._records:
            return [0.0, 0.0, 0.0, 0.0]
        return [self._min_lon, self._min_lat, self._max_lon, self._max_lat]

    def _query_geom(self, geom):
        if self._tree is None:
            return []
        return [self._records[i] for i in self._tree.query(geom)]

    def query_bbox(self, min_lat, min_lon, max_lat, max_lon):
        """Feature records whose bounding box intersects the lat/lon box (coarse)."""
        return self._query_geom(box(min_lon, min_lat, max_lon, max_lat))

    def query_buffered_line(self, coords, tolerance_m):
        """Feature records near a (lat, lon) polyline, within ~tolerance_m.

        Coarse bbox+buffer candidate filter only.
        TODO(PR-B): apply the full parallelism filter (heading / overlap) so that
        MVUM features which merely cross the route are rejected, keeping only those
        that run alongside it.
        """
        if not coords:
            return []
        pts = [(lon, lat) for (lat, lon) in coords]
        geom = LineString(pts) if len(pts) >= 2 else Point(pts[0])
        avg_lat = sum(lat for (lat, lon) in coords) / len(coords)
        return self._query_geom(geom.buffer(_buffer_degrees_for_meters(tolerance_m, avg_lat)))


def parse_date_range(date_str: str) -> List[Tuple[int, int, int, int]]:
    """
    Parse MVUM date range strings like "05/01-11/30" or "06/15-10/15,12/01-03/31".

    Returns list of (start_month, start_day, end_month, end_day) tuples.
    Returns empty list if unparseable.
    """
    if not date_str or date_str.strip() == "":
        return []

    ranges = []
    # Split by comma for multi-period strings
    for part in date_str.split(","):
        part = part.strip()
        # Match MM/DD-MM/DD pattern
        match = re.match(r"(\d{1,2})/(\d{1,2})-(\d{1,2})/(\d{1,2})", part)
        if match:
            try:
                sm, sd, em, ed = int(match.group(1)), int(match.group(2)), int(match.group(3)), int(match.group(4))
                if 1 <= sm <= 12 and 1 <= sd <= 31 and 1 <= em <= 12 and 1 <= ed <= 31:
                    ranges.append((sm, sd, em, ed))
            except ValueError:
                pass

    return ranges


def is_date_in_range(month: int, day: int, ranges: List[Tuple[int, int, int, int]]) -> bool:
    """
    Check if a given month/day falls within any of the date ranges.
    Handles ranges that wrap around year end (e.g., 12/01-03/31).
    """
    if not ranges:
        return True  # No ranges = assume open

    date_num = month * 100 + day  # Simple numeric comparison

    for sm, sd, em, ed in ranges:
        start_num = sm * 100 + sd
        end_num = em * 100 + ed

        if start_num <= end_num:
            # Normal range (e.g., 05/01-11/30)
            if start_num <= date_num <= end_num:
                return True
        else:
            # Wrapping range (e.g., 12/01-03/31)
            if date_num >= start_num or date_num <= end_num:
                return True

    return False


def check_access(
    status_field: Optional[str],
    dates_field: Optional[str],
    seasonal: Optional[str],
    check_date: Optional[Tuple[int, int]] = None
) -> Optional[bool]:
    """
    Determine if a road/trail is open to a vehicle type.

    Args:
        status_field: Value of vehicle-class field (e.g., "open", null)
        dates_field: Value of *_DATESOPEN field (e.g., "05/01-11/30")
        seasonal: Value of SEASONAL field ("yearlong", "seasonal")
        check_date: Optional (month, day) tuple to check against date ranges

    Returns:
        True = open
        False = closed
        None = no data (field not populated, defer to SYMBOL)
    """
    if status_field is None or status_field.strip() == "":
        return None  # No data

    status = status_field.strip().lower()

    if status != "open":
        return False  # Explicitly closed or restricted

    # Status is "open" - check seasonal restrictions
    if check_date is not None:
        month, day = check_date

        # Parse date ranges
        if dates_field:
            ranges = parse_date_range(dates_field)
            if ranges:
                return is_date_in_range(month, day, ranges)

        # No date field but seasonal = "yearlong" means always open
        if seasonal and seasonal.strip().lower() == "yearlong":
            return True

        # Seasonal with no dates - assume open (data quality issue)
        if seasonal and seasonal.strip().lower() == "seasonal":
            warnings.warn(f"Seasonal road/trail with no DATESOPEN, assuming open")
            return True

    return True  # Open with no date check


def get_mode_field(mode: str) -> Tuple[str, str]:
    """
    Get the MVUM field names for a given travel mode.

    Returns (status_field, dates_field) tuple.
    """
    mode_mapping = {
        "atv": ("atv", "atv_datesopen"),
        "motorcycle": ("motorcycle", "motorcycle_datesopen"),
        "mtb": ("e_bike_class1", "e_bike_class1_dur"),  # Closest analog for e-bikes
        "vehicle": ("highclearancevehicle", "highclearancevehicle_datesopen"),
        "passenger": ("passengervehicle", "passengervehicle_datesopen"),
    }

    return mode_mapping.get(mode, ("highclearancevehicle", "highclearancevehicle_datesopen"))


def symbol_to_access(symbol: str, mode: str, maint_level: Optional[str] = None) -> Optional[bool]:
    """
    Fallback: interpret SYMBOL field when per-vehicle-class fields are null.

    MVUM SYMBOL meanings (roads):
        1 = Open to all vehicles
        2 = Open to highway legal vehicles only
        3 = Road closed to motorized
        4 = Road open seasonally
        11 = Administrative use only
        12 = Decommissioned

    For trails, similar logic applies based on TRAILCLASS.
    """
    if symbol is None:
        return None

    sym = str(symbol).strip()

    # Symbol 1: Open to all
    if sym == "1":
        return True

    # Symbol 2: Highway legal only
    if sym == "2":
        # ATVs/motorcycles typically not highway legal
        if mode in ("atv", "motorcycle"):
            return False
        return True

    # Symbol 3: Closed to motorized
    if sym == "3":
        return False

    # Symbol 4: Seasonally open (assume open if no date check)
    if sym == "4":
        return True

    # Symbol 11/12: Administrative/decommissioned = closed
    if sym in ("11", "12"):
        return False

    # Unknown symbol - defer
    return None


class MVUMReader:
    """
    Reader for MVUM data from navi.db.

    Queries roads and trails by bounding box and returns access grids.
    """

    def __init__(self, db_path: Path = None):
        self.db_path = Path(db_path) if db_path else navi_db_path()
        self._conn = None

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            if not self.db_path.exists():
                raise FileNotFoundError(f"navi.db not found at {self.db_path}")
            self._conn = sqlite3.connect(str(self.db_path))
            self._conn.row_factory = sqlite3.Row
            # Load Spatialite extension if available
            try:
                self._conn.enable_load_extension(True)
                self._conn.load_extension("mod_spatialite")
            except Exception:
                pass  # Spatialite not available, will use manual bbox queries
        return self._conn

    def table_exists(self, table_name: str) -> bool:
        """Check if an MVUM table exists."""
        conn = self._get_conn()
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,)
        )
        return cur.fetchone() is not None

    def query_roads_bbox(
        self,
        south: float, north: float, west: float, east: float,
        mode: str = "atv",
        check_date: Optional[Tuple[int, int]] = None
    ) -> List[Dict]:
        """
        Query MVUM roads within a bounding box.

        Returns list of dicts with access info for the given mode.
        """
        if not self.table_exists("mvum_roads"):
            return []

        conn = self._get_conn()

        # Query using bbox on geometry
        # Since we don't have spatialite, we'll query all and filter in Python
        # For production, consider pre-computing bbox columns
        cur = conn.execute("""
            SELECT ogc_fid, id, name, symbol, operationalmaintlevel, seasonal,
                   atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                   highclearancevehicle, highclearancevehicle_datesopen,
                   passengervehicle, passengervehicle_datesopen,
                   e_bike_class1, e_bike_class1_dur,
                   shape
            FROM mvum_roads
        """)

        status_field, dates_field = get_mode_field(mode)
        results = []

        for row in cur:
            # Parse geometry to check bbox intersection
            # The shape is stored as WKB blob
            shape = row["shape"]
            if shape is None:
                continue

            # Quick bbox check using geometry extent
            # Since we don't have Spatialite functions, we'll include all
            # and let the rasterization handle it

            access = check_access(
                row[status_field] if status_field in row.keys() else None,
                row[dates_field] if dates_field in row.keys() else None,
                row["seasonal"],
                check_date
            )

            # Fallback to SYMBOL if no per-vehicle data
            if access is None:
                access = symbol_to_access(row["symbol"], mode, row["operationalmaintlevel"])

            if access is not None:
                results.append({
                    "id": row["id"],
                    "name": row["name"],
                    "access": access,
                    "symbol": row["symbol"],
                    "maint_level": row["operationalmaintlevel"],
                    "shape": shape,
                })

        return results

    def query_trails_bbox(
        self,
        south: float, north: float, west: float, east: float,
        mode: str = "atv",
        check_date: Optional[Tuple[int, int]] = None
    ) -> List[Dict]:
        """
        Query MVUM trails within a bounding box.
        """
        if not self.table_exists("mvum_trails"):
            return []

        conn = self._get_conn()

        cur = conn.execute("""
            SELECT ogc_fid, id, name, symbol, seasonal, trailclass,
                   atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                   highclearancevehicle, highclearancevehicle_datesopen,
                   passengervehicle, passengervehicle_datesopen,
                   e_bike_class1, e_bike_class1_dur,
                   shape
            FROM mvum_trails
        """)

        status_field, dates_field = get_mode_field(mode)
        results = []

        for row in cur:
            shape = row["shape"]
            if shape is None:
                continue

            access = check_access(
                row[status_field] if status_field in row.keys() else None,
                row[dates_field] if dates_field in row.keys() else None,
                row["seasonal"],
                check_date
            )

            if access is None:
                access = symbol_to_access(row["symbol"], mode)

            if access is not None:
                results.append({
                    "id": row["id"],
                    "name": row["name"],
                    "access": access,
                    "symbol": row["symbol"],
                    "trail_class": row["trailclass"],
                    "shape": shape,
                })

        return results

    def query_nearest(
        self,
        lat: float, lon: float,
        radius_m: float = 50,
        table: str = "mvum_roads"
    ) -> Optional[Dict]:
        """
        Query the nearest MVUM feature to a point.

        Used for the places panel API.
        """
        if not self.table_exists(table):
            return None

        conn = self._get_conn()

        # Convert radius to degrees (approximate)
        radius_deg = radius_m / 111000

        # Query features in bbox around point
        if table == "mvum_roads":
            cur = conn.execute("""
                SELECT ogc_fid, id, name, forestname, districtname, symbol,
                       operationalmaintlevel, surfacetype, seasonal, jurisdiction,
                       passengervehicle, passengervehicle_datesopen,
                       highclearancevehicle, highclearancevehicle_datesopen,
                       atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                       fourwd_gt50inches, fourwd_gt50_datesopen,
                       twowd_gt50inches, twowd_gt50_datesopen,
                       e_bike_class1, e_bike_class1_dur,
                       e_bike_class2, e_bike_class2_dur,
                       e_bike_class3, e_bike_class3_dur,
                       shape
                FROM mvum_roads
                LIMIT 1000
            """)
        else:
            cur = conn.execute("""
                SELECT ogc_fid, id, name, forestname, districtname, symbol,
                       seasonal, jurisdiction, trailclass, trailsystem,
                       passengervehicle, passengervehicle_datesopen,
                       highclearancevehicle, highclearancevehicle_datesopen,
                       atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                       fourwd_gt50inches, fourwd_gt50_datesopen,
                       twowd_gt50inches, twowd_gt50_datesopen,
                       e_bike_class1, e_bike_class1_dur,
                       e_bike_class2, e_bike_class2_dur,
                       e_bike_class3, e_bike_class3_dur,
                       shape
                FROM mvum_trails
                LIMIT 1000
            """)

        # Find nearest feature
        # This is a simplified approach - for production, use spatial index
        query_point = Point(lon, lat)
        nearest = None
        min_dist = float('inf')

        for row in cur:
            try:
                geom = wkb.loads(row["shape"])
                dist = query_point.distance(geom)
                if dist < min_dist and dist < radius_deg:
                    min_dist = dist
                    nearest = dict(row)
                    nearest["geometry"] = geom
            except Exception:
                continue

        if nearest:
            # Convert geometry to GeoJSON
            nearest["geojson"] = nearest["geometry"].__geo_interface__
            del nearest["geometry"]
            del nearest["shape"]
            return nearest

        return None

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None


# ── Process-level decoded-feature cache (O3a perf) ────────────────────────────────
# query_*_bbox ignore the bbox and scan the whole mvum_roads+mvum_trails tables, and the
# WKB decode (the dominant cost) is bbox- AND mode-independent, so the decoded feature set
# is cacheable once per worker process. We also pre-compute each motorized mode's access
# flag at build time (check_date=None, the only value the Auto path ever passes), turning
# 3 redundant full-table decodes per request into one cold decode + cheap per-request raster.
_CACHE_MODES = ("mtb", "atv", "vehicle")     # motorized modes baked into the cache
_FEATURE_CACHE = None                        # list of (geom, (minx,miny,maxx,maxy), {mode: access})
_FEATURE_CACHE_LOCK = threading.Lock()

_ROADS_SQL = """SELECT ogc_fid, id, name, symbol, operationalmaintlevel, seasonal,
                       atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                       highclearancevehicle, highclearancevehicle_datesopen,
                       passengervehicle, passengervehicle_datesopen,
                       e_bike_class1, e_bike_class1_dur, shape FROM mvum_roads"""
_TRAILS_SQL = """SELECT ogc_fid, id, name, symbol, seasonal, trailclass,
                        atv, atv_datesopen, motorcycle, motorcycle_datesopen,
                        highclearancevehicle, highclearancevehicle_datesopen,
                        passengervehicle, passengervehicle_datesopen,
                        e_bike_class1, e_bike_class1_dur, shape FROM mvum_trails"""


def _parse_check_date(check_date):
    """'MM/DD' -> (month, day) or None (matches the inline parse in the legacy path)."""
    if check_date:
        m = re.match(r"(\d{1,2})/(\d{1,2})", check_date)
        if m:
            return (int(m.group(1)), int(m.group(2)))
    return None


def _row_access(row, table, mode, check_date):
    """Per-mode access (True=open / False=closed / None=not applicable) — identical logic to
    query_roads_bbox / query_trails_bbox."""
    status_field, dates_field = get_mode_field(mode)
    keys = row.keys()
    access = check_access(
        row[status_field] if status_field in keys else None,
        row[dates_field] if dates_field in keys else None,
        row["seasonal"], check_date)
    if access is None:
        if table == "mvum_roads":
            access = symbol_to_access(row["symbol"], mode, row["operationalmaintlevel"])
        else:
            access = symbol_to_access(row["symbol"], mode)
    return access


def _rasterize_feature(grid, geom, value, west, north, pixel_lon, pixel_lat):
    """Bresenham-rasterize a (Multi)LineString into grid — extracted verbatim from the
    legacy get_mvum_access_grid inner loop so the cache and fallback paths can't diverge."""
    if geom.geom_type == "MultiLineString":
        coords_list = [list(line.coords) for line in geom.geoms]
    elif geom.geom_type == "LineString":
        coords_list = [list(geom.coords)]
    else:
        return
    for coords in coords_list:
        for i in range(len(coords) - 1):
            x1, y1 = coords[i]
            x2, y2 = coords[i + 1]
            _draw_line(grid, int((north - y1) / pixel_lat), int((x1 - west) / pixel_lon),
                       int((north - y2) / pixel_lat), int((x2 - west) / pixel_lon), value)


def _load_all_decoded_features(db_path):
    """Decode all mvum_roads + mvum_trails geometries ONCE; pre-compute each motorized mode's
    access at check_date=None. Returns [(geom, bounds, {mode: access}), ...]. Raises if the DB
    is missing (propagated so callers fall back to None — graceful degradation)."""
    t0 = _time.perf_counter()
    reader = MVUMReader(db_path)
    out = []
    try:
        conn = reader._get_conn()
        for table, sql in (("mvum_roads", _ROADS_SQL), ("mvum_trails", _TRAILS_SQL)):
            if not reader.table_exists(table):
                continue
            for row in conn.execute(sql):
                shape = row["shape"]
                if shape is None:
                    continue
                try:
                    geom = wkb.loads(shape)
                except Exception:
                    continue
                acc = {m: _row_access(row, table, m, None) for m in _CACHE_MODES}
                if all(a is None for a in acc.values()):
                    continue                      # applies to no mode (legacy: excluded)
                out.append((geom, geom.bounds, acc))
    finally:
        reader.close()
    logger.info("mvum: decoded %d features into process cache in %.2fs",
                len(out), _time.perf_counter() - t0)
    return out


def _get_feature_cache(db_path=None):
    """Lazy, threadsafe-init process-level decoded-feature cache. Read-only after init."""
    global _FEATURE_CACHE
    if _FEATURE_CACHE is None:
        with _FEATURE_CACHE_LOCK:
            if _FEATURE_CACHE is None:
                _FEATURE_CACHE = _load_all_decoded_features(db_path)
    return _FEATURE_CACHE


def _rasterize_uncached(grid, south, north, west, east, mode, parsed_date,
                        pixel_lon, pixel_lat, db_path):
    """Legacy per-request path (query + decode + rasterize) — used for the rare seasonal
    (check_date set) case so its behaviour is preserved exactly."""
    reader = MVUMReader(db_path)
    try:
        for feats in (reader.query_roads_bbox(south, north, west, east, mode, parsed_date),
                      reader.query_trails_bbox(south, north, west, east, mode, parsed_date)):
            for feat in feats:
                try:
                    geom = wkb.loads(feat["shape"])
                except Exception:
                    continue
                minx, miny, maxx, maxy = geom.bounds
                if maxx < west or minx > east or maxy < south or miny > north:
                    continue
                _rasterize_feature(grid, geom, 1 if feat["access"] else 255,
                                   west, north, pixel_lon, pixel_lat)
    finally:
        reader.close()


def get_mvum_access_grid(
    south: float, north: float, west: float, east: float,
    target_shape: Tuple[int, int],
    mode: Literal["foot", "mtb", "atv", "vehicle"] = "atv",
    check_date: Optional[str] = None,
    db_path: Path = None     # None → navi_db_path() (env NAVI_OFFROUTE_NAVI_DB)
) -> np.ndarray:
    """MVUM access grid (uint8: 0=no data, 1=open, 255=closed) for one mode over a bbox.

    Cache-backed (O3a) for the common path (check_date=None, motorized mode): rasterizes from
    the process-wide decoded-feature cache. Falls back to the legacy per-request query+decode
    for seasonal checks or unusual modes. Foot bypasses MVUM (zeros). Signature unchanged."""
    if mode == "foot":
        return np.zeros(target_shape, dtype=np.uint8)
    grid = np.zeros(target_shape, dtype=np.uint8)
    rows, cols = target_shape
    pixel_lat = (north - south) / rows
    pixel_lon = (east - west) / cols
    parsed_date = _parse_check_date(check_date)

    if parsed_date is None and mode in _CACHE_MODES:
        for geom, (minx, miny, maxx, maxy), acc in _get_feature_cache(db_path):
            if maxx < west or minx > east or maxy < south or miny > north:
                continue
            a = acc.get(mode)
            if a is None:
                continue
            _rasterize_feature(grid, geom, 1 if a else 255, west, north, pixel_lon, pixel_lat)
    else:
        _rasterize_uncached(grid, south, north, west, east, mode, parsed_date,
                            pixel_lon, pixel_lat, db_path)
    return grid


def get_mvum_access_grids_all_modes(
    south: float, north: float, west: float, east: float,
    target_shape: Tuple[int, int],
    modes: List[str],
    check_date: Optional[str] = None,
    db_path: Path = None,
) -> Dict[str, np.ndarray]:
    """Build MVUM access grids for several motorized modes in ONE pass over the cached features
    (vs N independent decodes). Returns {mode: uint8 grid}, same per-grid semantics as
    get_mvum_access_grid. Seasonal (check_date set) defers per-mode to the legacy path."""
    rows, cols = target_shape
    pixel_lat = (north - south) / rows
    pixel_lon = (east - west) / cols
    grids = {m: np.zeros(target_shape, dtype=np.uint8) for m in modes}
    parsed_date = _parse_check_date(check_date)

    if parsed_date is not None:
        for m in modes:
            grids[m] = get_mvum_access_grid(south, north, west, east, target_shape,
                                            m, check_date, db_path)
        return grids

    for geom, (minx, miny, maxx, maxy), acc in _get_feature_cache(db_path):
        if maxx < west or minx > east or maxy < south or miny > north:
            continue
        for m in modes:
            a = acc.get(m)
            if a is None:
                continue
            _rasterize_feature(grids[m], geom, 1 if a else 255, west, north, pixel_lon, pixel_lat)
    return grids


def _draw_line(grid: np.ndarray, r1: int, c1: int, r2: int, c2: int, value: int):
    """Draw a line on the grid using Bresenham's algorithm."""
    rows, cols = grid.shape

    dr = abs(r2 - r1)
    dc = abs(c2 - c1)
    sr = 1 if r1 < r2 else -1
    sc = 1 if c1 < c2 else -1
    err = dr - dc

    r, c = r1, c1

    while True:
        if 0 <= r < rows and 0 <= c < cols:
            # Only overwrite if current value is 0 (no data) or we're marking closed
            if grid[r, c] == 0 or value == 255:
                grid[r, c] = value

        if r == r2 and c == c2:
            break

        e2 = 2 * err
        if e2 > -dc:
            err -= dc
            r += sr
        if e2 < dr:
            err += dr
            c += sc


if __name__ == "__main__":
    import sys

    print("=" * 60)
    print("MVUM Reader Test")
    print("=" * 60)

    reader = MVUMReader()

    if not reader.table_exists("mvum_roads"):
        print("ERROR: mvum_roads table not found in navi.db")
        sys.exit(1)

    # Test bbox query (Sawtooth NF area)
    print("\n[1] Testing bbox query (Sawtooth NF area)...")
    roads = reader.query_roads_bbox(
        south=43.5, north=44.0, west=-115.0, east=-114.0,
        mode="atv"
    )
    print(f"  Found {len(roads)} roads")

    open_count = sum(1 for r in roads if r["access"])
    closed_count = sum(1 for r in roads if not r["access"])
    print(f"  Open to ATV: {open_count}")
    print(f"  Closed to ATV: {closed_count}")

    # Test with seasonal date
    print("\n[2] Testing with date check (July 15)...")
    roads_summer = reader.query_roads_bbox(
        south=43.5, north=44.0, west=-115.0, east=-114.0,
        mode="atv",
        check_date=(7, 15)
    )
    open_summer = sum(1 for r in roads_summer if r["access"])
    print(f"  Open to ATV on 07/15: {open_summer}")

    print("\n[3] Testing with date check (January 15)...")
    roads_winter = reader.query_roads_bbox(
        south=43.5, north=44.0, west=-115.0, east=-114.0,
        mode="atv",
        check_date=(1, 15)
    )
    open_winter = sum(1 for r in roads_winter if r["access"])
    print(f"  Open to ATV on 01/15: {open_winter}")

    # Test grid generation
    print("\n[4] Testing grid generation...")
    grid = get_mvum_access_grid(
        south=43.5, north=44.0, west=-115.0, east=-114.0,
        target_shape=(500, 1000),
        mode="atv"
    )
    print(f"  Grid shape: {grid.shape}")
    print(f"  No data (0): {np.sum(grid == 0)}")
    print(f"  Open (1): {np.sum(grid == 1)}")
    print(f"  Closed (255): {np.sum(grid == 255)}")

    reader.close()
    print("\nDone.")
