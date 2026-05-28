"""HPA* two-level runtime tests (Phase H3). Abstract search + coverage/freshness fallback on
synthetic tile DBs; dispatcher gating end-to-end. Refinement on live rasters is exercised in
H4 ops / H5 path-quality, not here (these inputs are deterministic without the real builder)."""
import logging
import sqlite3

import numpy as np
import pytest

from services.navi_offroute import astar, hpa_build as hb
import services.navi_offroute.router as router_mod
import services.navi_offroute.transitions as p_trans
from services.navi_offroute.router import OffrouteRouter
from services.navi_offroute.transitions import _latlon_to_pixel as _ll2px, _pixel_to_latlon as _px2ll

# Four-chunk region (0,0),(1,0),(0,1),(1,1) with a known path 0,0 -> 1,0 -> 1,1.
_CHUNKS = [(0, 0), (0, 1), (1, 0), (1, 1)]
# bounds = (south, north, west, east); spans chunks 0..1 in both axes.
_BOUNDS = (0.001, hb.CHUNK_DEG + 0.001, 0.001, hb.CHUNK_DEG + 0.001)


def _make_tile_db(path, rows, hash_ok=True):
    conn = sqlite3.connect(path)
    hb._init_schema(conn)
    conn.executemany(hb._INSERT, rows)
    h = astar._hpa_profile_hash() if hash_ok else "wrong-hash"
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('mode_profile_hash', ?)", (h,))
    conn.commit()
    conn.close()


def _base_rows():
    # One trivial row per chunk so all four count as "present", plus the (1,0) hop 15->10
    # that carries the only non-seam cost on the 0,0 -> 1,0 -> 1,1 route.
    rows = [(cx, cy, 0, 0, 1, 99.0) for (cx, cy) in _CHUNKS]
    rows.append((1, 0, 0, 15, 10, 5.0))   # left entrance -> bottom entrance, foot, cost 5
    return rows


def test_hpa_abstract_search_finds_path_through_chunks(tmp_path):
    db = str(tmp_path / "tiles.db")
    _make_tile_db(db, _base_rows())
    conn = sqlite3.connect(db)
    # START -> right entrance of (0,0); top entrance of (1,1) -> GOAL (both free pseudo-edges).
    start_edges = {(0, 0, 5, 0): 0.0}
    goal_edges = {(1, 1, 0, 0): 0.0}
    seq, cost = astar._hpa_abstract_search(conn, _CHUNKS, [0], start_edges, goal_edges)
    conn.close()
    assert seq is not None
    chunks_visited = [s[:2] for s in seq]
    assert chunks_visited[0] == (0, 0) and chunks_visited[-1] == (1, 1)
    # 0,0 -> (seam) 1,0 -> (intra 5s) -> (seam) 1,1 ; only the (1,0) intra row is non-free.
    assert cost == pytest.approx(5.0)
    assert (1, 0) in chunks_visited


def test_hpa_falls_back_on_missing_chunk(tmp_path):
    db = str(tmp_path / "tiles.db")
    rows = [r for r in _base_rows() if not (r[0] == 1 and r[1] == 1)]   # drop chunk (1,1)
    _make_tile_db(db, rows)
    idx, path, cost, reason = astar.astar_hpa_multimode(
        db, {"bounds": _BOUNDS}, 0.002, 0.002, hb.CHUNK_DEG + 0.0005, hb.CHUNK_DEG + 0.0005,
        np.array([0]), np.array([0]), "pragmatic", None)
    assert idx == -1 and reason == "missing_chunk"
    assert path.shape == (0, 3) and not np.isfinite(cost)


def test_hpa_falls_back_on_stale_profile_hash(tmp_path):
    db = str(tmp_path / "tiles.db")
    _make_tile_db(db, _base_rows(), hash_ok=False)
    idx, path, cost, reason = astar.astar_hpa_multimode(
        db, {"bounds": _BOUNDS}, 0.002, 0.002, hb.CHUNK_DEG + 0.0005, hb.CHUNK_DEG + 0.0005,
        np.array([0]), np.array([0]), "pragmatic", None)
    assert idx == -1 and reason == "stale_profile"


# ── dispatcher gating (end-to-end through _route_auto, stubbed readers) ───────

def _p_meta(rows, cols, cell_m=100.0):
    import math
    dlat = cell_m / 111000.0
    dlon = cell_m / (111000.0 * math.cos(math.radians(40.0)))
    return {"bounds": (40.0, 40.0 + rows * dlat, -111.0, -111.0 + cols * dlon),
            "pixel_size_lat": -dlat, "pixel_size_lon": dlon,
            "origin_lat": 40.0 + rows * dlat, "origin_lon": -111.0,
            "cell_size_m": cell_m, "shape": (rows, cols)}


class _Grid:
    def __init__(self, a): self._a = a
    def get_friction_grid(self, **k): return self._a
    def get_barrier_grid(self, **k): return self._a
    def get_trails_grid(self, **k): return self._a
    def get_wilderness_grid(self, **k): return self._a
    def close(self): pass


class _StubDem:
    def __init__(self, e, m): self._e, self._m = e, m
    def get_elevation_grid(self, **k): return self._e, self._m
    def latlon_to_pixel(self, lat, lon, m): return _ll2px(lat, lon, m)
    def pixel_to_latlon(self, r, c, m): return _px2ll(r, c, m)
    def close(self): pass


def _stub_router(monkeypatch):
    n = 20
    meta = _p_meta(n, n)
    r = OffrouteRouter()
    r.dem_reader = _StubDem(np.full((n, n), 1000.0), meta)
    fr = np.full((n, n), 30, dtype=np.uint8)
    r.friction_reader = _Grid(fr)
    r.barrier_reader = _Grid(np.zeros((n, n), np.uint8))
    r.trail_reader = _Grid(np.zeros((n, n), np.uint8))
    r.wilderness_reader = _Grid(np.zeros((n, n), np.uint8))
    monkeypatch.setattr(router_mod, "get_mvum_access_grid",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no mvum")))
    monkeypatch.setattr(p_trans, "load_parking_index",
                        lambda *a, **k: type("I", (), {"query_parking_near_line": lambda s, c, buffer_m=2000: []})())
    monkeypatch.setattr(p_trans, "load_trailheads",
                        lambda *a, **k: type("I", (), {"query_trailheads_near_line": lambda s, c, buffer_m=2000: []})())
    monkeypatch.setattr(p_trans, "get_surface_change_candidates", lambda *a, **k: [])
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes",
                        lambda self, lat, lon, cache: frozenset({"foot"}))
    s_lat, s_lon = _px2ll(5, 5, meta)
    e_lat, e_lon = _px2ll(15, 15, meta)
    return r, (s_lat, s_lon, e_lat, e_lon)


def test_hpa_dispatcher_uses_hpa_when_tile_db_set(tmp_path, monkeypatch, caplog):
    db = str(tmp_path / "tiles.db")
    _make_tile_db(db, _base_rows())                       # a real file so os.path.exists passes
    monkeypatch.setattr(router_mod, "HPA_TILE_DB", db)

    calls = []

    def spy(*a, **k):
        calls.append(True)
        return 0, np.array([[5, 5, 0], [6, 6, 0]], dtype=np.int64), 123.0, None
    monkeypatch.setattr(router_mod, "astar_hpa_multimode", spy)

    r, (s_lat, s_lon, e_lat, e_lon) = _stub_router(monkeypatch)
    with caplog.at_level(logging.INFO, logger="navi_offroute.router"):
        out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    assert out["status"] == "ok"
    assert calls == [True]                                # HPA was attempted + taken
    assert "auto: HPA*" in caplog.text

    # strict boundary mode -> ineligible -> HPA not attempted, logged fallback, unified used.
    calls.clear()
    caplog.clear()
    r2, _ = _stub_router(monkeypatch)
    with caplog.at_level(logging.INFO, logger="navi_offroute.router"):
        out2 = r2._route_auto(s_lat, s_lon, e_lat, e_lon, "strict")
    assert out2["status"] == "ok"
    assert calls == []                                    # spy never called
    assert "HPA fallback reason=boundary_mode" in caplog.text
