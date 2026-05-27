"""MVUM Layer 3a tests: trailhead transition index.

The index tests build a TrailheadIndex from a synthetic trail_entry_points table.
(The multi-modal Auto hybrid tests were removed in unified-graph Phase 5 with
OffrouteRouter._try_hybrid_auto.)
"""
import sqlite3

import numpy as np

import pytest

from services.navi_offroute.mvum_transitions import TrailheadIndex


def _trailhead_db(tmp_path, points):
    """points: list of (lat, lon, highway_class, name)."""
    db = tmp_path / "navi.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE trail_entry_points "
        "(id INTEGER PRIMARY KEY, lat REAL, lon REAL, highway_class TEXT, name TEXT)"
    )
    conn.executemany(
        "INSERT INTO trail_entry_points (lat, lon, highway_class, name) VALUES (?,?,?,?)",
        points,
    )
    conn.commit()
    conn.close()
    return db


# ── index ────────────────────────────────────────────────────────────────

def test_trailhead_index_loads(tmp_path):
    db = _trailhead_db(tmp_path, [
        (44.00, -114.00, "track", "Trailhead A"),
        (44.01, -114.02, "residential", "Road B"),
    ])
    idx = TrailheadIndex(db_path=db)
    assert idx.count == 2
    assert len(idx.records) == idx.count == 2
    rec = idx.records[0]
    assert rec["name"] == "Trailhead A"
    assert rec["road_class"] == "track"   # highway_class surfaced as road_class
    assert rec["lat"] == 44.00 and rec["lon"] == -114.00


def test_trailhead_index_numpy_backing(tmp_path):
    db = _trailhead_db(tmp_path, [
        (44.00, -114.00, "track", "A"),
        (44.01, -114.02, "residential", "B"),
        (44.02, -114.03, "path", "C"),
    ])
    idx = TrailheadIndex(db_path=db)
    assert idx._lats.dtype == np.float64
    assert idx._lons.dtype == np.float64
    assert len(idx._lats) == len(idx._lons) == idx.count == 3
    assert idx._lats[1] == 44.01 and idx._lons[1] == -114.02


def test_query_trailheads_near_line_returns_close_only(tmp_path):
    # One point sits right on the line; one is ~30 km away (well outside 2 km).
    db = _trailhead_db(tmp_path, [
        (44.000, -114.000, "track", "On Line"),
        (44.300, -114.000, "track", "Far Away"),
    ])
    idx = TrailheadIndex(db_path=db)
    line = [(44.000, -114.010), (44.000, 113.990 * -1)]  # ~horizontal segment at lat 44
    near = idx.query_trailheads_near_line(line, buffer_m=2000)
    names = {r["name"] for r in near}
    assert "On Line" in names
    assert "Far Away" not in names
