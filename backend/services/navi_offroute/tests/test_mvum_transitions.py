"""MVUM Layer 3a tests: trailhead transition index + multi-modal Auto hybrids.

The index tests build a TrailheadIndex from a synthetic trail_entry_points table.
The hybrid tests drive OffrouteRouter._try_hybrid_auto on a bare instance with a
stubbed self.route, so no Valhalla/DEM dependencies are exercised.
"""
import sqlite3

import numpy as np

import pytest

from services.navi_offroute.mvum_transitions import TrailheadIndex
from services.navi_offroute.router import OffrouteRouter


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


# ── hybrid selection (stubbed self.route) ──────────────────────────────────

def _ok_leg(distance_km, minutes, scenario="D"):
    return {
        "status": "ok",
        "route": {"type": "FeatureCollection", "features": [
            {"type": "Feature",
             "properties": {"segment_type": "network", "network_mode": "x"},
             "geometry": {"type": "LineString",
                          "coordinates": [[-114.0, 44.0], [-114.1, 44.1]]}},
        ]},
        "summary": {
            "total_distance_km": distance_km,
            "total_effort_minutes": minutes,
            "network_distance_km": distance_km,
            "network_duration_minutes": minutes,
            "wilderness_distance_km": 0.0,
            "wilderness_effort_minutes": 0.0,
            "scenario": scenario,
        },
    }


class _FakeTrailheads:
    def __init__(self, records):
        self._records = records

    def query_trailheads_near_line(self, coords, buffer_m=2000):
        return list(self._records)


def _bare_router(trailheads=None):
    r = object.__new__(OffrouteRouter)
    r.spatial_index = None
    r.trailhead_index = trailheads
    return r


def _winning_single_mode(distance_km, minutes):
    """A single-mode best_result with a combined polyline of the given distance."""
    res = _ok_leg(distance_km, minutes)
    res["route"]["features"].append({
        "type": "Feature",
        "properties": {"segment_type": "combined"},
        "geometry": {"type": "LineString",
                     "coordinates": [[-114.0, 44.0], [-114.5, 44.0]]},
    })
    res["selected_mode"] = "vehicle"
    return res


def test_hybrid_meets_mitigations(monkeypatch):
    # Short trip (< MIN_HYBRID_DISTANCE_KM) -> never goes hybrid.
    th = _FakeTrailheads([{"lat": 44.0, "lon": -114.25, "name": "TH", "road_class": "track"}])
    r = _bare_router(th)
    monkeypatch.setattr(OffrouteRouter, "route",
                        lambda self, *a, **k: _ok_leg(1.0, 5.0))
    best = _winning_single_mode(distance_km=5.0, minutes=60.0)  # 5 km < 8 km
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 60.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is None


def test_hybrid_wins_with_big_savings(monkeypatch):
    th = _FakeTrailheads([{"lat": 44.0, "lon": -114.25, "name": "Sawtooth TH",
                           "road_class": "track"}])
    r = _bare_router(th)

    # Drive legs are fast; offroad legs are short-but-meaningful and fast. Any leg
    # combo sums to ~50 min vs the 120 min single-mode winner -> saves > 15 min.
    def fake_route(self, s_lat, s_lon, e_lat, e_lon, mode="foot",
                   boundary_mode="pragmatic", annotate_mvum=True, **k):
        if mode == "vehicle":
            return _ok_leg(12.0, 20.0)
        return _ok_leg(4.0, 30.0)  # 4w/2w/foot offroad legs (>= 0.8 km)
    monkeypatch.setattr(OffrouteRouter, "route", fake_route)

    best = _winning_single_mode(distance_km=20.0, minutes=120.0)
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 120.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is not None
    assert out["selected_mode"] == "hybrid"
    assert out["summary"]["scenario"] == "multi"
    assert len(out["summary"]["legs"]) == 2
    assert out["summary"]["total_effort_minutes"] == pytest.approx(50.0)
    # one transition marker present in the combined feature collection
    kinds = [f["properties"].get("kind") for f in out["route"]["features"]]
    assert kinds.count("transition") == 1
    trans = next(f for f in out["route"]["features"]
                 if f["properties"].get("kind") == "transition")
    assert trans["properties"]["name"] == "Sawtooth TH"
    assert trans["geometry"]["type"] == "Point"


def test_hybrid_skips_trivial_offroad_detour(monkeypatch):
    th = _FakeTrailheads([{"lat": 44.0, "lon": -114.25, "name": "TH", "road_class": "track"}])
    r = _bare_router(th)

    # Offroad legs are below HYBRID_MIN_OFFROAD_KM (0.8 km) -> rejected, so even
    # though the time math would otherwise win, no hybrid is produced.
    def fake_route(self, s_lat, s_lon, e_lat, e_lon, mode="foot",
                   boundary_mode="pragmatic", annotate_mvum=True, **k):
        if mode == "vehicle":
            return _ok_leg(12.0, 20.0)
        return _ok_leg(0.3, 5.0)  # < 0.8 km offroad
    monkeypatch.setattr(OffrouteRouter, "route", fake_route)

    best = _winning_single_mode(distance_km=20.0, minutes=120.0)
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 120.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is None


def test_no_trailheads_falls_back_to_single_mode(monkeypatch):
    r = _bare_router(_FakeTrailheads([]))  # no candidates near the line
    monkeypatch.setattr(OffrouteRouter, "route",
                        lambda self, *a, **k: _ok_leg(5.0, 10.0))
    best = _winning_single_mode(distance_km=20.0, minutes=120.0)
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 120.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is None


def test_hybrid_not_taken_when_savings_below_threshold(monkeypatch):
    # Hybrid total (40 min) is faster than the winner (50 min) but only by 10 min
    # (< HYBRID_MIN_TIME_SAVINGS_MIN = 15) -> single-mode winner is kept.
    th = _FakeTrailheads([{"lat": 44.0, "lon": -114.25, "name": "TH", "road_class": "track"}])
    r = _bare_router(th)

    def fake_route(self, s_lat, s_lon, e_lat, e_lon, mode="foot",
                   boundary_mode="pragmatic", annotate_mvum=True, **k):
        if mode == "vehicle":
            return _ok_leg(12.0, 20.0)
        return _ok_leg(4.0, 20.0)
    monkeypatch.setattr(OffrouteRouter, "route", fake_route)

    best = _winning_single_mode(distance_km=20.0, minutes=50.0)
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 50.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is None
