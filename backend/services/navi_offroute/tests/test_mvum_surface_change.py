"""MVUM Layer 3c tests: surface-change transition candidate extraction.

The boundary tests feed synthetic trace_attributes ``edges`` straight into the pure
``_edges_to_candidates`` (no Valhalla). (The _try_hybrid_auto integration test was
removed in unified-graph Phase 5 with the hybrid path.)
"""
import pytest

from services.navi_offroute.mvum_surface_change import (
    classify_surface, _edges_to_candidates, encode_polyline6,
    PAVED, UNPAVED, TRACK, TRAIL,
)
from services.navi_offroute.router import OffrouteRouter


# Coords ~50 m apart along a meridian at lat 44 (0.00045 deg lat ~= 50 m).
def _line(n):
    return [(44.0 + i * 0.00045, -114.0) for i in range(n)]


def _edge(surface=None, use="road", road_class="unclassified", bi=0, ei=1):
    return {"surface": surface, "use": use, "road_class": road_class,
            "begin_shape_index": bi, "end_shape_index": ei}


def _run(category_edges):
    """category_edges: list of (surface, use, road_class) -> one edge per vertex step."""
    return [_edge(surf, use, rc, bi=i, ei=i + 1)
            for i, (surf, use, rc) in enumerate(category_edges)]


# ── classify_surface ───────────────────────────────────────────────────────

def test_classify_surface():
    assert classify_surface({"surface": "asphalt", "use": "road"}) == PAVED
    assert classify_surface({"surface": "paved_smooth", "use": "road"}) == PAVED
    assert classify_surface({"surface": "gravel", "use": "road"}) == UNPAVED
    assert classify_surface({"surface": "dirt"}) == UNPAVED          # no use -> unpaved
    assert classify_surface({"surface": "dirt", "use": "road"}) == TRACK   # dirt road
    assert classify_surface({"surface": "compacted", "use": "road"}) == TRACK
    assert classify_surface({"use": "track", "surface": "gravel"}) == TRACK
    assert classify_surface({"use": "path"}) == TRAIL
    assert classify_surface({"use": "cycleway"}) == TRAIL
    # paved alley (service_other) must NOT be a track
    assert classify_surface({"surface": "paved_smooth", "use": "alley",
                             "road_class": "service_other"}) == PAVED
    # unpaved service road IS a track
    assert classify_surface({"surface": "dirt", "use": "alley",
                             "road_class": "service_other"}) == TRACK
    assert classify_surface({"surface": "something_weird"}) is None


# ── boundary extraction ──────────────────────────────────────────────────────

def test_extract_boundaries():
    # 5 paved edges (0..5, ~250 m) then 5 unpaved (5..10, ~250 m). Boundary at vertex 5.
    edges = _run([("paved_smooth", "road", "tertiary")] * 5
                 + [("gravel", "road", "unclassified")] * 5)
    coords = _line(11)
    out = _edges_to_candidates(edges, coords)
    assert len(out) == 1
    c = out[0]
    assert c["name"] == "Surface change: paved→unpaved"
    assert c["lat"] == coords[5][0] and c["lon"] == coords[5][1]
    assert c["road_class"] == "tertiary"   # from the *previous* (paved) edge


def test_noise_filter():
    # paved (0..5, 250 m), 1-step unpaved blip (5..6, ~50 m < 100 m), paved (6..11).
    edges = _run([("paved_smooth", "road", "tertiary")] * 5
                 + [("gravel", "road", "unclassified")]
                 + [("paved_smooth", "road", "tertiary")] * 5)
    coords = _line(12)
    out = _edges_to_candidates(edges, coords)
    assert out == []   # blip collapsed; surrounding paved runs re-merged


def test_no_changes_returns_empty():
    edges = _run([("paved_smooth", "road", "tertiary")] * 8)
    out = _edges_to_candidates(edges, _line(9))
    assert out == []


def test_encode_polyline6_roundtrips_with_router_decoder():
    coords = [(43.6135, -116.2024), (43.62, -116.21), (43.6535, -116.2524)]
    r = object.__new__(OffrouteRouter)
    decoded = r._decode_polyline(encode_polyline6(coords))   # [lon, lat]
    back = [(round(c[1], 5), round(c[0], 5)) for c in decoded]
    assert back == [(round(la, 5), round(lo, 5)) for la, lo in coords]
