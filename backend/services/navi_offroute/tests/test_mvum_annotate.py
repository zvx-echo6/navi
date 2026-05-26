"""MVUM Layer 1 per-edge annotation tests (isolated; fake spatial index, no DB)."""
from datetime import datetime

from shapely.geometry import LineString

from services.navi_offroute.mvum_annotate import annotate_network_edges


def _feat(geom, fid="trail:1", **cols):
    rec = {"geometry": geom, "feature_id": fid}
    rec.update(cols)
    return rec


class _FakeIndex:
    """Returns a preset list of candidate records per query_buffered_line call (in order)."""
    def __init__(self, per_call):
        self.per_call = per_call
        self.i = 0

    def query_buffered_line(self, coords, tolerance_m):
        r = self.per_call[self.i] if self.i < len(self.per_call) else []
        self.i += 1
        return r


# A NE-running edge and a parallel / perpendicular NFS-like feature near it.
EDGE = [(44.000, -114.000), (44.010, -113.990)]              # (lat, lon), heading NE
PARALLEL = LineString([(-114.002, 43.998), (-113.988, 44.012)])   # NE  (lon, lat)
PERPENDICULAR = LineString([(-113.988, 43.998), (-114.002, 44.012)])  # NW


def test_parallel_match():
    idx = _FakeIndex([[_feat(PARALLEL, atv="open", atv_datesopen=None,
                             seasonal="yearlong", symbol="1")]])
    out = annotate_network_edges(EDGE, "4w", idx)
    assert len(out) == 1
    assert out[0].mvum_status == "open"
    assert out[0].matched_features == ["trail:1"]


def test_perpendicular_rejected():
    idx = _FakeIndex([[_feat(PERPENDICULAR, atv="open", seasonal="yearlong", symbol="1")]])
    out = annotate_network_edges(EDGE, "4w", idx)
    assert len(out) == 1
    assert out[0].mvum_status == "unknown"          # parallelism filter rejected it
    assert out[0].matched_features == []


def test_seasonal_closure():
    # ATV open only May-Sep; querying mid-January -> closed.
    idx = _FakeIndex([[_feat(PARALLEL, atv="open", atv_datesopen="05/01-09/30",
                             seasonal="seasonal", symbol="4")]])
    out = annotate_network_edges(EDGE, "4w", idx, on_date=datetime(2026, 1, 15))
    assert out[0].mvum_status == "closed"


def test_symbol_fallback():
    # Per-class field NULL, SYMBOL=3 (closed to motorized) -> closed.
    idx = _FakeIndex([[_feat(PARALLEL, atv=None, atv_datesopen=None,
                             seasonal=None, symbol="3", operationalmaintlevel=None)]])
    out = annotate_network_edges(EDGE, "4w", idx)
    assert out[0].mvum_status == "closed"


def test_summary_count():
    # 4 coords -> 3 edges; middle edge closed, others open -> 1 closed.
    coords = [(44.000, -114.000), (44.010, -113.990),
              (44.020, -113.980), (44.030, -113.970)]
    open_f = _feat(PARALLEL, atv="open", seasonal="yearlong", symbol="1")
    closed_f = _feat(PARALLEL, atv=None, symbol="3")
    idx = _FakeIndex([[open_f], [closed_f], [open_f]])
    out = annotate_network_edges(coords, "4w", idx)
    assert len(out) == 3
    assert sum(1 for e in out if e.mvum_status == "closed") == 1
