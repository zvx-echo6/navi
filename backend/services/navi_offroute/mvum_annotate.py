"""MVUM Layer 1 — per-edge access annotation.

Walks a network leg's coordinate pairs, finds *parallel* MVUM features via the Layer-0
spatial index, and tags each edge with its access status for the travel mode. Pure
annotation — no routing-decision changes and no Valhalla changes (that is Layer 2c).
"""
import math
from dataclasses import dataclass
from typing import List, Optional

from shapely.geometry import Point

from .mvum import check_access, get_mode_field, symbol_to_access

PARALLEL_TOLERANCE_M = 10.0      # query buffer around each edge
PARALLEL_MAX_ANGLE_DEG = 45.0    # accept features whose acute angle to the edge <= this

# Route travel mode -> MVUM access-class key understood by get_mode_field / symbol_to_access.
# foot is handled separately (MVUM is motor-vehicle specific). "auto" never reaches here:
# _route_auto resolves it to a concrete candidate before the scenario handler runs.
_ROUTE_MODE_TO_MVUM = {
    "2w": "mtb",           # -> e_bike_class1
    "4w": "atv",           # -> atv
    "vehicle": "vehicle",  # -> highclearancevehicle
}

# Restrictiveness ranking for picking the WORST status across matched features.
_RANK = {"open": 0, "unknown": 1, "closed": 2}


@dataclass
class EdgeAnnotation:
    coord_pair_index: int
    matched_features: List[str]
    mvum_status: str  # "open" | "closed" | "unknown"

    def to_dict(self):
        return {
            "coord_pair_index": self.coord_pair_index,
            "matched_features": self.matched_features,
            "mvum_status": self.mvum_status,
        }


def _bearing(lat1, lon1, lat2, lon2):
    """Initial bearing in degrees [0,360) from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _acute_angle(b1, b2):
    """Acute angle between two bearings, treating opposite directions as parallel (0..90)."""
    d = abs(b1 - b2) % 360.0
    if d > 180.0:
        d = 360.0 - d
    return min(d, 180.0 - d)


def _feature_bearing_near(geom, lon, lat):
    """Local bearing (deg) of a (Multi)LineString near point (lon,lat); None if not derivable."""
    try:
        length = geom.length
        if length <= 0:
            return None
        t = geom.project(Point(lon, lat))
        step = min(max(length * 0.05, 1e-9), length)
        a = geom.interpolate(max(0.0, t - step))
        b = geom.interpolate(min(length, t + step))
        if a.equals(b):
            return None
        return _bearing(a.y, a.x, b.y, b.x)
    except Exception:
        return None


def _status_for_feature(record, status_field, dates_field, mvum_mode, check_date):
    acc = check_access(record.get(status_field), record.get(dates_field),
                       record.get("seasonal"), check_date)
    if acc is None:  # per-class field null -> SYMBOL fallback
        acc = symbol_to_access(record.get("symbol"), mvum_mode,
                               record.get("operationalmaintlevel"))
    if acc is True:
        return "open"
    if acc is False:
        return "closed"
    return "unknown"


def annotate_network_edges(coords, mode, spatial_index, on_date=None):
    """Annotate each consecutive coordinate pair of a network leg with MVUM access.

    coords: list[(lat, lon)]. Returns list[EdgeAnnotation], one per pair (len(coords)-1).
    foot -> always "open" (MVUM is motor-vehicle specific). spatial_index None or an
    unmappable mode -> "unknown" for every edge (no crash)."""
    if not coords or len(coords) < 2:
        return []
    n = len(coords) - 1

    if mode == "foot":
        return [EdgeAnnotation(i, [], "open") for i in range(n)]
    if spatial_index is None:
        return [EdgeAnnotation(i, [], "unknown") for i in range(n)]
    mvum_mode = _ROUTE_MODE_TO_MVUM.get(mode)
    if mvum_mode is None:
        return [EdgeAnnotation(i, [], "unknown") for i in range(n)]

    status_field, dates_field = get_mode_field(mvum_mode)
    check_date = (on_date.month, on_date.day) if on_date else None

    out = []
    for i in range(n):
        (lat1, lon1), (lat2, lon2) = coords[i], coords[i + 1]
        edge_brg = _bearing(lat1, lon1, lat2, lon2)
        midlon, midlat = (lon1 + lon2) / 2.0, (lat1 + lat2) / 2.0
        matched = []
        worst = None
        for rec in spatial_index.query_buffered_line(
                [(lat1, lon1), (lat2, lon2)], PARALLEL_TOLERANCE_M):
            fb = _feature_bearing_near(rec.get("geometry"), midlon, midlat)
            if fb is None or _acute_angle(edge_brg, fb) > PARALLEL_MAX_ANGLE_DEG:
                continue  # crossing-but-not-parallel -> reject
            matched.append(rec.get("feature_id"))
            st = _status_for_feature(rec, status_field, dates_field, mvum_mode, check_date)
            if worst is None or _RANK[st] > _RANK[worst]:
                worst = st
        out.append(EdgeAnnotation(i, matched, worst if worst is not None else "unknown"))
    return out
