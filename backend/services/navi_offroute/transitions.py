"""Transition-cell sourcing for unified-graph Auto (spec §4–§5).

Gathers mode-switch cells from four sources (parking, trailheads, road termini,
surface-change boundaries), maps each to a DEM grid pixel, de-dupes, and applies the
per-type closest-15-within-5 km cap. Returns the flat directed (row, col, from_idx,
to_idx, cost_s) list astar_multigoal_multimode consumes. Pure sourcing + grid mapping;
no raster math (cost.py), no router wiring (Phase 4). lat/lon → pixel mirrors
DEMReader.latlon_to_pixel (shared/dem.py).
"""
import math

import numpy as np
import scipy.ndimage as ndi

from .cost import (
    TRANSITION_COST_PARKING_S,
    TRANSITION_COST_TRAILHEAD_S,
    TRANSITION_COST_ROAD_TERMINUS_S,
    TRANSITION_COST_SURFACE_CHANGE_S,
)
from .mvum_parking import load_parking_index
from .mvum_transitions import load_trailheads
from .mvum_surface_change import get_surface_change_candidates

# Fixed mode ordering (spec §2.1; matches astar_multigoal_multimode).
MODE_INDEX = {"foot": 0, "2w": 1, "4w": 2, "vehicle": 3}

_CAP_PER_TYPE = 15        # §5: keep the closest 15 cells per transition type
_CAP_RADIUS_M = 5000.0    # §5: within 5 km of the endpoint line
_EARTH_R_M = 6_371_000.0
_BLOCKED_ACCESS = frozenset({"private", "no", "permit"})  # defensive; index already drops these


# ── lat/lon ↔ pixel (mirror DEMReader, shared/dem.py) ───────────────────────────

def _latlon_to_pixel(lat, lon, meta):
    # Mirrors DEMReader.latlon_to_pixel; +1e-6 stabilises the center round-trip (float error).
    row = int((meta["origin_lat"] - lat) / abs(meta["pixel_size_lat"]) + 1e-6)
    col = int((lon - meta["origin_lon"]) / meta["pixel_size_lon"] + 1e-6)
    return row, col


def _pixel_to_latlon(row, col, meta):
    lat = meta["origin_lat"] + row * meta["pixel_size_lat"]
    lon = meta["origin_lon"] + col * meta["pixel_size_lon"]
    return lat, lon


def _bidir(lat, lon, pairs, cost_s):
    """Expand each bidirectional m↔m' pair into two directed (lat, lon, from, to, cost) tuples (§4)."""
    out = []
    for a, b in pairs:
        ia, ib = MODE_INDEX[a], MODE_INDEX[b]
        out.append((lat, lon, ia, ib, cost_s))
        out.append((lat, lon, ib, ia, cost_s))
    return out


def _bearing(p1, l1, p2, l2):
    return math.atan2(math.sin(l2 - l1) * math.cos(p2),
                      math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(l2 - l1))


def _cross_track_distance_m(lat, lon, line):
    """Great-circle perpendicular distance (m) from a point to the line through the two
    endpoints (spec §5). Falls back to point distance for a degenerate line."""
    (lat1, lon1), (lat2, lon2) = line
    p1, l1 = math.radians(lat1), math.radians(lon1)
    p3, l3 = math.radians(lat), math.radians(lon)
    h = math.sin((p3 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p3) * math.sin((l3 - l1) / 2) ** 2
    d13 = 2 * math.asin(min(1.0, math.sqrt(h)))            # haversine angle, start->point
    if lat1 == lat2 and lon1 == lon2:
        return d13 * _EARTH_R_M
    dth = _bearing(p1, l1, p3, l3) - _bearing(p1, l1, math.radians(lat2), math.radians(lon2))
    return abs(math.asin(max(-1.0, min(1.0, math.sin(d13) * math.sin(dth))))) * _EARTH_R_M


def _cap_candidates(raw, line):
    """§5 cap for one transition type: group by (lat, lon) so a point's several directed
    tuples count as ONE candidate, keep the closest _CAP_PER_TYPE points within
    _CAP_RADIUS_M of `line`, flatten. line=None -> uncapped (test convenience).

    Vectorised (O2a perf): the per-unique-point cross-track distance is computed in one numpy
    pass instead of ~1M pure-Python great-circle calls (the dominant Route B cost). The math
    is identical to the scalar _cross_track_distance_m / _bearing (retained as the test
    oracle); the result is set-equivalent — the kernel consumes the cells order-independently."""
    if not raw:
        return []
    if line is None:
        return list(raw)
    (lat1, lon1), (lat2, lon2) = line
    pts = np.array([(t[0], t[1]) for t in raw], dtype=np.float64)   # (N, 2) lat/lon
    uniq, inv = np.unique(pts, axis=0, return_inverse=True)         # one row per physical point
    inv = inv.reshape(-1)

    # Cross-track distance per unique point -- vectorised twin of _cross_track_distance_m.
    phi1, lam1 = math.radians(lat1), math.radians(lon1)
    phi3, lam3 = np.radians(uniq[:, 0]), np.radians(uniq[:, 1])
    h = (np.sin((phi3 - phi1) / 2) ** 2
         + math.cos(phi1) * np.cos(phi3) * np.sin((lam3 - lam1) / 2) ** 2)
    d13 = 2 * np.arcsin(np.minimum(1.0, np.sqrt(h)))               # angular distance (radians)
    if lat1 == lat2 and lon1 == lon2:
        dxt = d13 * _EARTH_R_M                                     # degenerate line -> point dist
    else:
        theta12 = _bearing(phi1, lam1, math.radians(lat2), math.radians(lon2))
        theta13 = np.arctan2(
            np.sin(lam3 - lam1) * np.cos(phi3),
            math.cos(phi1) * np.sin(phi3) - math.sin(phi1) * np.cos(phi3) * np.cos(lam3 - lam1))
        dxt = np.abs(np.arcsin(np.clip(np.sin(d13) * np.sin(theta13 - theta12), -1.0, 1.0))) * _EARTH_R_M

    within = np.nonzero(dxt <= _CAP_RADIUS_M)[0]                   # unique points within 5 km
    if within.size > _CAP_PER_TYPE:                               # keep the closest _CAP_PER_TYPE
        within = within[np.argpartition(dxt[within], _CAP_PER_TYPE)[:_CAP_PER_TYPE]]
    keep = np.isin(inv, within)                                   # raw entries whose point survives
    return [raw[i] for i in np.nonzero(keep)[0].tolist()]


def parking_transitions_near_line(line, buffer_m=5000):
    """Parking mode switches near the line (§4): foot↔{vehicle,4w,2w} at
    TRANSITION_COST_PARKING_S. Blocked-access lots skipped."""
    coords = [tuple(line[0]), tuple(line[1])]
    index = load_parking_index()
    pairs = (("foot", "vehicle"), ("foot", "4w"), ("foot", "2w"))
    out = []
    for rec in index.query_parking_near_line(coords, buffer_m):
        if rec.get("access") in _BLOCKED_ACCESS:
            continue
        out.extend(_bidir(rec["lat"], rec["lon"], pairs, TRANSITION_COST_PARKING_S))
    return out


def trailhead_transitions_near_line(line, buffer_m=5000):
    """Trailhead mode switches near the line (§4): foot↔4w, foot↔2w at
    TRANSITION_COST_TRAILHEAD_S (no full-size vehicle — the tow vehicle stays parked)."""
    coords = [tuple(line[0]), tuple(line[1])]
    index = load_trailheads()
    pairs = (("foot", "4w"), ("foot", "2w"))
    out = []
    for rec in index.query_trailheads_near_line(coords, buffer_m):
        out.extend(_bidir(rec["lat"], rec["lon"], pairs, TRANSITION_COST_TRAILHEAD_S))
    return out


def road_terminus_transitions(meta, trail_grid, elevation=None):
    """Road-terminus mode switches from the trail raster (spec §4): a road(5)/track(15) cell
    with a passable off-network 8-neighbour (value 0; finite elev when `elevation` given).
    foot↔vehicle at TRANSITION_COST_ROAD_TERMINUS_S. Pure raster scan, no DB — fixes §1.

    O2b: the per-road-cell 8-neighbour Python loop is replaced by one 3×3 binary dilation of
    the off-network mask (scipy.ndimage). `border_value=0` treats out-of-bounds neighbours as
    on-network, matching the scalar version's OOB skip — NOT np.roll, which would wrap the
    raster edges and fabricate phantom neighbours. A road cell is never off-network itself, so
    dilating with the centre included is equivalent to the loop's strict-neighbour test. The
    surviving cell set (and the 2 directed tuples per cell) is identical; only emission order
    differs, and the cap / kernel consume the cells order-independently."""
    pairs = (("foot", "vehicle"),)
    road = (trail_grid == 5) | (trail_grid == 15)
    offnet = (trail_grid == 0)
    if elevation is not None:
        offnet &= np.isfinite(elevation)
    offnet_neighbour = ndi.binary_dilation(
        offnet, structure=np.ones((3, 3), dtype=bool), border_value=0)
    terminus = road & offnet_neighbour                # road cell with ≥1 off-network 8-neighbour
    rs, cs = np.nonzero(terminus)
    out = []
    for r, c in zip(rs.tolist(), cs.tolist()):
        lat, lon = _pixel_to_latlon(r, c, meta)
        out.extend(_bidir(lat, lon, pairs, TRANSITION_COST_ROAD_TERMINUS_S))
    return out


def surface_change_transitions_near_line(line, valhalla_url, buffer_m=5000):
    """Surface-change mode switches along the line (§4) at TRANSITION_COST_SURFACE_CHANGE_S
    (free). The candidate record encodes no mode info, so the default wheeled swaps
    vehicle↔4w and 4w↔2w are used. (buffer_m accepted for signature parity.)"""
    coords = [tuple(line[0]), tuple(line[1])]
    pairs = (("vehicle", "4w"), ("4w", "2w"))
    out = []
    for rec in get_surface_change_candidates(coords, valhalla_url):
        out.extend(_bidir(rec["lat"], rec["lon"], pairs, TRANSITION_COST_SURFACE_CHANGE_S))
    return out


def gather_transition_cells(meta, endpoint_line=None, trail_grid=None,
                            elevation=None, valhalla_url=None, buffer_m=5000):
    """All transition cells for one Auto search (spec §4–§5). Sources the four types,
    caps each independently (closest 15 within 5 km of `endpoint_line`), maps lat/lon →
    grid pixel via `meta`, drops out-of-bounds, de-dupes per (row, col, from, to), and
    returns the flat directed list. Sources lacking their input are skipped: the
    line-based ones need `endpoint_line`, road-terminus needs `trail_grid`, surface
    additionally needs `valhalla_url`. endpoint_line=None -> uncapped (test convenience).
    """
    rows, cols = meta["shape"]
    per_type = []
    if endpoint_line is not None:
        per_type.append(_cap_candidates(
            parking_transitions_near_line(endpoint_line, buffer_m), endpoint_line))
        per_type.append(_cap_candidates(
            trailhead_transitions_near_line(endpoint_line, buffer_m), endpoint_line))
    if trail_grid is not None:
        per_type.append(_cap_candidates(
            road_terminus_transitions(meta, trail_grid, elevation), endpoint_line))
    if endpoint_line is not None and valhalla_url:
        per_type.append(_cap_candidates(
            surface_change_transitions_near_line(endpoint_line, valhalla_url, buffer_m),
            endpoint_line))

    seen = set()
    out = []
    for raw in per_type:
        for (lat, lon, from_m, to_m, cost_s) in raw:
            row, col = _latlon_to_pixel(lat, lon, meta)
            if not (0 <= row < rows and 0 <= col < cols):
                continue
            key = (row, col, from_m, to_m)
            if key in seen:
                continue
            seen.add(key)
            out.append((row, col, from_m, to_m, cost_s))
    return out
