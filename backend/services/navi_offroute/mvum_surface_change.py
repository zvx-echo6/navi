"""
MVUM Layer 3c: surface-change transition candidates for multi-modal Auto.

Walks the winning single-mode polyline through Valhalla's ``trace_attributes`` and
emits a transition candidate wherever the road surface category changes (e.g.
pavement -> dirt, dirt -> track, track -> trail). These let Auto suggest "pull off
where the pavement turns to dirt and switch vehicles" hybrid trips even when no MVUM
trailhead sits nearby. Candidates share the trailhead record shape
(``{lat, lon, name, road_class}``) so ``_try_hybrid_auto`` consumes them unchanged.

Surface categories use Valhalla's normalized surface enum (paved_smooth / paved /
paved_rough / compacted / dirt / gravel / path / impassable) as observed on the live
instance, plus the raw OSM surface names for robustness.
"""
import logging
import math

import requests

logger = logging.getLogger("navi_offroute.mvum_surface_change")

# Surface-change tuning.
MIN_STRETCH_M = 100.0     # a new category must persist this far, else it is noise
MAX_BOUNDARIES = 10       # cap candidates emitted per route
TRACE_TIMEOUT_S = 20

# Categories.
PAVED = "PAVED"
UNPAVED = "UNPAVED"
TRACK = "TRACK"
TRAIL = "TRAIL"

# Valhalla normalized surface enum + raw OSM surface names (defensive).
PAVED_SURFACES = frozenset({
    "paved_smooth", "paved", "paved_rough",
    "asphalt", "concrete", "concrete:lanes", "concrete:plates",
    "paving_stones", "sett", "cobblestone", "metal", "wood",
})
UNPAVED_SURFACES = frozenset({
    "compacted", "dirt", "gravel",
    "fine_gravel", "ground", "sand", "earth", "mud", "grass", "unpaved",
})
DIRT_TRACK_SURFACES = frozenset({"dirt", "compacted"})
TRAIL_USES = frozenset({
    "path", "footway", "cycleway", "bridleway", "steps", "pedestrian",
    "mountain_bike", "sidewalk",
})


def classify_surface(edge):
    """Classify one trace_attributes edge into PAVED / UNPAVED / TRACK / TRAIL, or
    None when it cannot be categorised (unknown surfaces break runs, not boundaries).

    Precedence: trail-like ``use`` first, then track (``use==track``; or an
    *unpaved* service road; or a dirt/compacted ``use==road``), then plain
    unpaved/paved surface.
    """
    use = (edge.get("use") or "").lower()
    road_class = (edge.get("road_class") or "").lower()
    surface = (edge.get("surface") or "").lower()

    if use in TRAIL_USES:
        return TRAIL
    # A paved alley/driveway is road_class==service_other on this Valhalla, so only
    # treat service_other as a track when its surface is NOT paved.
    if use == "track" or (road_class == "service_other" and surface not in PAVED_SURFACES):
        return TRACK
    if surface in DIRT_TRACK_SURFACES and use == "road":
        return TRACK
    if surface in UNPAVED_SURFACES:
        return UNPAVED
    if surface in PAVED_SURFACES:
        return PAVED
    return None


def _haversine_m(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def _cumulative_m(coords):
    """Cumulative geodesic distance (m) along the (lat, lon) polyline; len == len(coords)."""
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _haversine_m(coords[i - 1], coords[i]))
    return cum


def encode_polyline6(coords, precision=6):
    """Encode (lat, lon) coords as a Valhalla polyline6 string (the inverse of the
    router's _decode_polyline)."""
    factor = 10 ** precision
    out = []
    prev_lat = prev_lon = 0
    for lat, lon in coords:
        lat_i = int(round(lat * factor))
        lon_i = int(round(lon * factor))
        for delta in (lat_i - prev_lat, lon_i - prev_lon):
            v = ~(delta << 1) if delta < 0 else (delta << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = lat_i, lon_i
    return "".join(out)


def _collapse_short_runs(runs, cum, min_m):
    """Drop category runs shorter than ``min_m`` (merging each into a neighbour) and
    re-merge adjacent same-category runs, so a brief reversion does not raise a
    spurious boundary. Each run is ``{cat, start_v, end_v, last_edge}``."""
    runs = [dict(r) for r in runs]
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, r in enumerate(runs):
            end_v = min(r["end_v"], len(cum) - 1)
            start_v = min(r["start_v"], len(cum) - 1)
            if cum[end_v] - cum[start_v] >= min_m:
                continue
            if i > 0:
                runs[i - 1]["end_v"] = r["end_v"]
                runs[i - 1]["last_edge"] = r["last_edge"]
                del runs[i]
            else:
                runs[i + 1]["start_v"] = r["start_v"]
                del runs[i]
            changed = True
            break
        j = 0
        while j < len(runs) - 1:
            if runs[j]["cat"] == runs[j + 1]["cat"]:
                runs[j]["end_v"] = runs[j + 1]["end_v"]
                runs[j]["last_edge"] = runs[j + 1]["last_edge"]
                del runs[j + 1]
            else:
                j += 1
    return runs


def _edges_to_candidates(edges, coords, max_boundaries=MAX_BOUNDARIES,
                         min_stretch_m=MIN_STRETCH_M):
    """Pure boundary extraction: trace_attributes ``edges`` (in order) + the input
    (lat, lon) ``coords`` -> surface-change candidate records."""
    if not edges or len(coords) < 2:
        return []
    cum = _cumulative_m(coords)

    # Group consecutive edges of the same category into runs.
    runs = []
    for edge in edges:
        cat = classify_surface(edge)
        bi = edge.get("begin_shape_index")
        ei = edge.get("end_shape_index")
        if bi is None or ei is None:
            continue
        if runs and runs[-1]["cat"] == cat:
            runs[-1]["end_v"] = ei
            runs[-1]["last_edge"] = edge
        else:
            runs.append({"cat": cat, "start_v": bi, "end_v": ei, "last_edge": edge})

    runs = _collapse_short_runs(runs, cum, min_stretch_m)

    candidates = []
    for prev, cur in zip(runs, runs[1:]):
        from_cat, to_cat = prev["cat"], cur["cat"]
        if from_cat is None or to_cat is None or from_cat == to_cat:
            continue
        v = cur["start_v"]
        if v < 0 or v >= len(coords):
            continue
        lat, lon = coords[v]
        candidates.append({
            "lat": lat,
            "lon": lon,
            "name": f"Surface change: {from_cat.lower()}→{to_cat.lower()}",
            "road_class": prev["last_edge"].get("road_class"),
        })
        if len(candidates) >= max_boundaries:
            break
    return candidates


def get_surface_change_candidates(coords, valhalla_url):
    """Transition candidates at surface-category boundaries along the (lat, lon)
    ``coords`` polyline. Returns [] on any trace failure (best-effort augmentation)."""
    if not coords or len(coords) < 2:
        return []
    payload = {
        "encoded_polyline": encode_polyline6(coords),
        "costing": "auto",
        "filters": {
            "attributes": [
                "edge.surface", "edge.road_class", "edge.use",
                "edge.begin_shape_index", "edge.end_shape_index",
            ],
            "action": "include",
        },
    }
    try:
        resp = requests.post(f"{valhalla_url}/trace_attributes",
                             json=payload, timeout=TRACE_TIMEOUT_S)
        resp.raise_for_status()
        edges = resp.json().get("edges", [])
    except Exception as e:
        logger.warning("trace_attributes failed; no surface-change candidates: %s", e)
        return []
    return _edges_to_candidates(edges, coords)
