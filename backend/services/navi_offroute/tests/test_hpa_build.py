"""HPA* precompute pipeline tests (Phase H2). Structural correctness on synthetic chunks;
no real DEM/readers, no ProcessPool — compute_chunk_rows is exercised directly in-process."""
import math
import sqlite3

import numpy as np

from services.navi_offroute import hpa_build as hb


def test_chunk_coords_deterministic():
    # Pure function of (lat, lon): identical on repeat, and matches the floor formula.
    lat, lon = 43.7500, -114.9000
    assert hb.chunk_coords(lat, lon) == hb.chunk_coords(lat, lon)
    assert hb.chunk_coords(lat, lon) == (
        int(math.floor(lon / hb.CHUNK_DEG)), int(math.floor(lat / hb.CHUNK_DEG)))
    # Adjacent points one chunk-step apart land in adjacent chunks; bounds enclose the point.
    cx, cy = hb.chunk_coords(lat, lon)
    s, w, n, e = hb.chunk_bounds(cx, cy)
    assert s <= lat < n and w <= lon < e
    assert hb.chunk_coords(lat + hb.CHUNK_DEG, lon) == (cx, cy + 1)


def test_entrance_cells_layout():
    cells = hb._entrance_cells(50, 50)
    assert len(cells) == 20
    assert all(0 <= r <= 49 and 0 <= c <= 49 for r, c in cells)
    # Index convention (spec §4): 0..4 top, 5..9 right, 10..14 bottom, 15..19 left.
    assert all(r == 0 for r, c in cells[0:5])           # top edge -> row 0
    assert all(c == 49 for r, c in cells[5:10])         # right edge -> col 49
    assert all(r == 49 for r, c in cells[10:15])        # bottom edge -> row 49
    assert all(c == 0 for r, c in cells[15:20])         # left edge -> col 0
    # Even spacing L→R / T→B along each edge (strictly increasing free coordinate).
    assert [c for _, c in cells[0:5]] == sorted(c for _, c in cells[0:5])
    assert [r for r, _ in cells[5:10]] == sorted(r for r, _ in cells[5:10])
    # Fractions 1/6..5/6 of the 49-cell span.
    assert [c for _, c in cells[0:5]] == [int(round(f * 49)) for f in hb.EDGE_FRACTIONS]


def _flat_chunk(n=50, fill_elev=1000.0):
    elevation = np.full((n, n), fill_elev, dtype=np.float64)
    friction_mult = np.ones((n, n), dtype=np.float64)
    friction_raw = np.full((n, n), 30, dtype=np.uint8)   # grass
    trails = np.zeros((n, n), dtype=np.uint8)
    wilderness = np.zeros((n, n), dtype=np.uint8)
    return elevation, friction_mult, friction_raw, trails, wilderness


def _cost(conn, mode_idx, fr, to):
    row = conn.execute(
        "SELECT cost_s FROM chunk_costs WHERE chunk_x=0 AND chunk_y=0 AND mode_idx=? "
        "AND from_entrance=? AND to_entrance=?", (mode_idx, fr, to)).fetchone()
    return row[0] if row else None


def test_build_one_chunk_fixture():
    elev, fmult, fraw, trails, wild = _flat_chunk()
    rows = hb.compute_chunk_rows(0, 0, elev, fmult, fraw, trails, wild,
                                 cell_size_m=30.0, modes=("foot",))
    conn = sqlite3.connect(":memory:")
    hb._init_schema(conn)
    conn.executemany(hb._INSERT, rows)

    # Flat passable grass: every foot entrance pair routes (380 finite directed pairs).
    assert len(rows) == 20 * 19
    # Distance monotonicity: along the top edge, 0→1 (adjacent) is cheaper than 0→4 (far).
    assert _cost(conn, 0, 0, 1) < _cost(conn, 0, 0, 4)
    # top-middle (2) -> bottom-middle (12): a straight vertical crossing.
    flat_mid = _cost(conn, 0, 2, 12)
    assert flat_mid is not None

    # A steep hill on the straight 2→12 column forces a detour / slope penalty -> costlier.
    elev_hill = elev.copy()
    elev_hill[20:30, 20:30] = 2600.0                     # ~1600 m bump over ~300 m: cliff-steep
    rows_h = hb.compute_chunk_rows(0, 0, elev_hill, fmult, fraw, trails, wild,
                                   cell_size_m=30.0, modes=("foot",))
    conn_h = sqlite3.connect(":memory:")
    hb._init_schema(conn_h)
    conn_h.executemany(hb._INSERT, rows_h)
    hill_mid = _cost(conn_h, 0, 2, 12)
    assert hill_mid is not None
    assert hill_mid > flat_mid                            # the hill is not free to cross
