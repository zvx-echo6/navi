"""MVUM Layer 2c exclude_polygons tests (isolated; fake spatial index, no DB)."""
import logging

from shapely.geometry import LineString

from services.navi_offroute.mvum_exclude import build_exclude_polygons, MAX_EXCLUDE_POLYGONS

START = (43.600, -116.200)
END = (43.700, -116.300)
LINE = LineString([(-116.250, 43.640), (-116.245, 43.650)])  # (lon, lat) in the route bbox


def _feat(geom=LINE, fid="trail:1", **cols):
    rec = {"geometry": geom, "feature_id": fid}
    rec.update(cols)
    return rec


class _FakeIndex:
    def __init__(self, recs):
        self.recs = recs

    def query_bbox(self, min_lat, min_lon, max_lat, max_lon):
        return self.recs


def _call(idx, mode="4w", boundary_mode="strict"):
    return build_exclude_polygons(START[0], START[1], END[0], END[1], mode,
                                  idx, None, boundary_mode)


def test_strict_builds_exclude_polygons():
    idx = _FakeIndex([_feat(atv=None, symbol="3")])  # closed to motorized (4w -> atv)
    out = _call(idx, mode="4w", boundary_mode="strict")
    assert out and len(out) >= 1
    assert out[0]["type"] == "Polygon"
    assert isinstance(out[0]["coordinates"][0], (list, tuple)) and len(out[0]["coordinates"][0]) >= 4


def test_pragmatic_returns_none():
    idx = _FakeIndex([_feat(atv=None, symbol="3")])
    assert _call(idx, mode="4w", boundary_mode="pragmatic") is None


def test_emergency_returns_none():
    idx = _FakeIndex([_feat(atv=None, symbol="3")])
    assert _call(idx, mode="4w", boundary_mode="emergency") is None


def test_foot_returns_none():
    idx = _FakeIndex([_feat(atv=None, symbol="3")])
    assert _call(idx, mode="foot", boundary_mode="strict") is None
    assert _call(idx, mode="foot", boundary_mode="pragmatic") is None


def test_open_features_not_excluded():
    idx = _FakeIndex([_feat(atv="open", seasonal="yearlong", symbol="1")])
    out = _call(idx, mode="4w", boundary_mode="strict")
    assert out == []   # nothing closed -> empty (router omits empty)


def test_polygon_cap(caplog):
    recs = [_feat(geom=LineString([(-116.25 + i * 1e-4, 43.64), (-116.25 + i * 1e-4, 43.645)]),
                  fid=f"trail:{i}", atv=None, symbol="3") for i in range(1000)]
    idx = _FakeIndex(recs)
    with caplog.at_level(logging.WARNING, logger="navi_offroute.mvum_exclude"):
        out = _call(idx, mode="4w", boundary_mode="strict")
    assert len(out) == MAX_EXCLUDE_POLYGONS == 500
    assert any("exceed cap" in r.message for r in caplog.records)
