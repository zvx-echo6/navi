"""MVUM Layer 2c — build Valhalla exclude_polygons for closure-avoiding routing.

For strict-boundary motorized routes, turn MVUM-closed segments into buffered
exclusion polygons so Valhalla actively routes around them. Only strict boundary mode
excludes; pragmatic/emergency keep Layer-1 annotate-only behavior. No wilderness, Layer-0
or Layer-1 changes.
"""
import logging
from datetime import datetime
from typing import List, Optional

from shapely.geometry import mapping

from .mvum import get_mode_field, _buffer_degrees_for_meters
from .mvum_annotate import _ROUTE_MODE_TO_MVUM, _status_for_feature

logger = logging.getLogger("navi_offroute.mvum_exclude")

EXCLUDE_BUFFER_M = 15.0        # buffer around a closed segment
BBOX_EXPAND_M = 5000.0         # candidate search box expansion around the route
MAX_EXCLUDE_POLYGONS = 500     # Valhalla request guard


def build_exclude_polygons(start_lat, start_lon, end_lat, end_lon, mode,
                           spatial_index, on_date, boundary_mode) -> Optional[List[dict]]:
    """Return GeoJSON Polygon dicts for MVUM segments closed to `mode`, or None when
    exclusion does not apply (foot, non-strict boundary, or no spatial index).

    The router converts these to Valhalla's array-of-rings exclude_polygons format.
    """
    if mode == "foot":
        return None
    if boundary_mode != "strict":
        return None
    if spatial_index is None:
        return None
    mvum_mode = _ROUTE_MODE_TO_MVUM.get(mode)
    if mvum_mode is None:   # unmappable / auto -> nothing to exclude
        return None

    on_date = on_date or datetime.now()
    status_field, dates_field = get_mode_field(mvum_mode)
    check_date = (on_date.month, on_date.day)

    min_lat, max_lat = min(start_lat, end_lat), max(start_lat, end_lat)
    min_lon, max_lon = min(start_lon, end_lon), max(start_lon, end_lon)
    mid_lat = (min_lat + max_lat) / 2.0
    bbox_buf = _buffer_degrees_for_meters(BBOX_EXPAND_M, mid_lat)
    seg_buf = _buffer_degrees_for_meters(EXCLUDE_BUFFER_M, mid_lat)

    candidates = spatial_index.query_bbox(
        min_lat - bbox_buf, min_lon - bbox_buf, max_lat + bbox_buf, max_lon + bbox_buf)

    polys: List[dict] = []
    for rec in candidates:
        if _status_for_feature(rec, status_field, dates_field, mvum_mode, check_date) != "closed":
            continue
        geom = rec.get("geometry")
        if geom is None or geom.is_empty:
            continue
        buffered = geom.buffer(seg_buf)
        if buffered.is_empty:
            continue
        if buffered.geom_type == "Polygon":
            parts = [buffered]
        elif buffered.geom_type == "MultiPolygon":
            parts = list(buffered.geoms)
        else:
            continue
        for part in parts:
            polys.append(mapping(part))

    if len(polys) > MAX_EXCLUDE_POLYGONS:
        logger.warning(
            "MVUM exclude polygons (%d) exceed cap; emitting first %d",
            len(polys), MAX_EXCLUDE_POLYGONS)
        return polys[:MAX_EXCLUDE_POLYGONS]
    return polys
