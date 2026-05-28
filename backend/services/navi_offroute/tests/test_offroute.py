"""Hermetic tests for navi-offroute (extraction #8) — service-shape, not routing
correctness. OffrouteRouter is mocked; MVUM uses a tiny fixture SQLite; admin
probes (Valhalla/PG/osmium) are mocked. No live PostGIS/Valhalla/osmium/DEM.
"""
import sqlite3

import pytest
from shapely import wkb
from shapely.geometry import Point

import services.navi_offroute.offroute_route as route_mod
import services.navi_offroute.admin as admin_mod
from services.navi_offroute.app import create_app

AUTH = {'X-Authentik-Username': 'matt'}


@pytest.fixture
def client():
    return create_app().test_client()


# ── /api/offroute — mocked router ─────────────────────────────────────────

class FakeRouter:
    instances = []
    route_result = {'status': 'ok', 'route': {'type': 'FeatureCollection', 'features': []},
                    'summary': {'total_distance_km': 1.2, 'total_effort_minutes': 30,
                                'barrier_crossings': 0, 'mvum_closed_crossings': 0}}
    raise_on_init = False
    raise_on_route = False

    def __init__(self):
        if FakeRouter.raise_on_init:
            raise RuntimeError('router init boom')
        self.closed = False
        FakeRouter.instances.append(self)

    def route(self, **kwargs):
        if FakeRouter.raise_on_route:
            raise RuntimeError('route boom')
        return FakeRouter.route_result

    def close(self):
        self.closed = True


@pytest.fixture
def fake_router(monkeypatch):
    FakeRouter.instances = []
    FakeRouter.raise_on_init = False
    FakeRouter.raise_on_route = False
    FakeRouter.route_result = {'status': 'ok', 'route': {'type': 'FeatureCollection', 'features': []},
                               'summary': {'total_distance_km': 1.2, 'total_effort_minutes': 30,
                                           'barrier_crossings': 0, 'mvum_closed_crossings': 0}}
    monkeypatch.setattr(route_mod, 'OffrouteRouter', FakeRouter)
    return FakeRouter


def _post(client, body):
    return client.post('/api/offroute', json=body)


def test_offroute_empty_body_400(client, fake_router):
    # Body parses to a falsy value (JSON null) → the "No JSON body provided" 400
    # branch. (A *malformed* body makes Flask's get_json() raise BadRequest, which
    # the outer except turns into 500 — faithful to recon; not this branch.)
    r = client.post('/api/offroute', data='null', content_type='application/json')
    assert r.status_code == 400 and r.get_json()['message'] == 'No JSON body provided'


def test_offroute_missing_coords_400(client, fake_router):
    assert _post(client, {'start': [43.6, -116.2]}).status_code == 400


def test_offroute_bad_start_shape_400(client, fake_router):
    assert _post(client, {'start': [1, 2, 3], 'end': [4, 5]}).status_code == 400


def test_offroute_bad_mode_400(client, fake_router):
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3], 'mode': 'spaceship'})
    assert r.status_code == 400 and 'mode must be' in r.get_json()['message']


def test_offroute_bad_boundary_mode_400(client, fake_router):
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3], 'boundary_mode': 'yolo'})
    assert r.status_code == 400 and 'boundary_mode must be' in r.get_json()['message']


def test_offroute_happy_path_shape(client, fake_router):
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3], 'mode': 'foot',
                       'boundary_mode': 'strict'})
    assert r.status_code == 200
    d = r.get_json()
    assert d['status'] == 'ok'
    assert d['route']['type'] == 'FeatureCollection'
    # the summary keys the UI reads (ManeuverList / DirectionsPanel)
    assert {'total_distance_km', 'total_effort_minutes', 'barrier_crossings',
            'mvum_closed_crossings'} <= set(d['summary'])
    assert fake_router.instances[0].closed is True   # always closed


def test_offroute_router_status_error_is_400(client, fake_router):
    fake_router.route_result = {'status': 'error', 'message': 'no route found'}
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3]})
    assert r.status_code == 400 and r.get_json()['message'] == 'no route found'


def test_offroute_router_init_raises_is_500(client, fake_router):
    fake_router.raise_on_init = True
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3]})
    assert r.status_code == 500 and r.get_json()['status'] == 'error'


def test_offroute_close_called_even_when_route_raises(client, fake_router):
    fake_router.raise_on_route = True
    r = _post(client, {'start': [43.6, -116.2], 'end': [43.7, -116.3]})
    assert r.status_code == 500                      # outer except -> 500
    assert fake_router.instances[0].closed is True   # finally still closed it


# ── /api/mvum — fixture SQLite ─────────────────────────────────────────────

_ROAD_COLS = ['ogc_fid', 'id', 'name', 'forestname', 'districtname', 'symbol',
              'operationalmaintlevel', 'surfacetype', 'seasonal', 'jurisdiction',
              'passengervehicle', 'passengervehicle_datesopen',
              'highclearancevehicle', 'highclearancevehicle_datesopen',
              'atv', 'atv_datesopen', 'motorcycle', 'motorcycle_datesopen',
              'fourwd_gt50inches', 'fourwd_gt50_datesopen',
              'twowd_gt50inches', 'twowd_gt50_datesopen',
              'e_bike_class1', 'e_bike_class1_dur', 'e_bike_class2', 'e_bike_class2_dur',
              'e_bike_class3', 'e_bike_class3_dur', 'shape']
_TRAIL_COLS = ['ogc_fid', 'id', 'name', 'forestname', 'districtname', 'symbol',
               'seasonal', 'jurisdiction', 'trailclass', 'trailsystem',
               'passengervehicle', 'passengervehicle_datesopen',
               'highclearancevehicle', 'highclearancevehicle_datesopen',
               'atv', 'atv_datesopen', 'motorcycle', 'motorcycle_datesopen',
               'fourwd_gt50inches', 'fourwd_gt50_datesopen',
               'twowd_gt50inches', 'twowd_gt50_datesopen',
               'e_bike_class1', 'e_bike_class1_dur', 'e_bike_class2', 'e_bike_class2_dur',
               'e_bike_class3', 'e_bike_class3_dur', 'shape']


def _make_table(conn, table, cols, row):
    conn.execute(f"CREATE TABLE {table} ({', '.join(cols)})")
    if row is not None:
        conn.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['?'] * len(cols))})",
                     [row.get(c) for c in cols])
    conn.commit()


def _shape_at(lat, lon):
    return wkb.dumps(Point(lon, lat))


def _mvum_db(tmp_path, monkeypatch, roads=None, trails=None):
    db = tmp_path / 'navi.db'
    conn = sqlite3.connect(db)
    if roads is not None:
        _make_table(conn, 'mvum_roads', _ROAD_COLS, roads)
    if trails is not None:
        _make_table(conn, 'mvum_trails', _TRAIL_COLS, trails)
    conn.close()
    monkeypatch.setenv('NAVI_OFFROUTE_NAVI_DB', str(db))
    return db


def test_mvum_road_happy_path(client, tmp_path, monkeypatch):
    _mvum_db(tmp_path, monkeypatch, roads={
        'ogc_fid': 1, 'id': 'FR 123', 'name': 'Some Forest Road',
        'forestname': 'Sawtooth National Forest', 'districtname': 'Ketchum RD',
        'surfacetype': 'NAT', 'operationalmaintlevel': '2 - HIGH CLEARANCE VEHICLES',
        'seasonal': 'Seasonal', 'symbol': 2,
        'passengervehicle': 'Open', 'passengervehicle_datesopen': '06/15-10/15',
        'atv': 'Open', 'shape': _shape_at(43.6150, -116.2023)})
    r = client.get('/api/mvum?lat=43.6150&lon=-116.2023&radius=500')
    assert r.status_code == 200
    d = r.get_json()
    assert d['status'] == 'ok'
    f = d['feature']
    assert f['id'] == 'FR 123' and f['forest'] == 'Sawtooth National Forest'
    assert f['maintenance_level'] == 2                       # parsed from "2 - HIGH…"
    assert f['access']['passenger_vehicle'] == {'status': 'Open', 'dates': '06/15-10/15'}
    assert set(f['access']) == {'passenger_vehicle', 'high_clearance', 'atv', 'motorcycle',
                                '4wd_gt50', '2wd_gt50', 'e_bike_class1', 'e_bike_class2', 'e_bike_class3'}


def test_mvum_falls_back_to_trails(client, tmp_path, monkeypatch):
    # No mvum_roads table → roads query returns None → trails consulted.
    _mvum_db(tmp_path, monkeypatch, trails={
        'ogc_fid': 1, 'id': 'TR 7', 'name': 'Goat Trail', 'forestname': 'Sawtooth NF',
        'trailclass': '2', 'trailsystem': 'Alpine', 'atv': 'Open',
        'shape': _shape_at(43.6150, -116.2023)})
    f = client.get('/api/mvum?lat=43.6150&lon=-116.2023&radius=500').get_json()['feature']
    assert f['id'] == 'TR 7' and f['trail_system'] == 'Alpine'


def test_mvum_no_match_returns_null_feature(client, tmp_path, monkeypatch):
    # Road exists but far outside the radius → null feature.
    _mvum_db(tmp_path, monkeypatch, roads={
        'ogc_fid': 1, 'id': 'FR 999', 'name': 'Far Road',
        'shape': _shape_at(0.0, 0.0)})
    d = client.get('/api/mvum?lat=43.6150&lon=-116.2023&radius=50').get_json()
    assert d == {'status': 'ok', 'feature': None}


def test_mvum_missing_coords_400(client):
    assert client.get('/api/mvum?lat=43.6').status_code == 400


def test_friction_reader_raises_file_not_found_when_missing(tmp_path):
    """The FileNotFoundError pre-check (review fix #2) fires before rasterio sees
    the path — consistent with the barriers/trails readers."""
    from services.navi_offroute.friction import FrictionReader
    reader = FrictionReader(tmp_path / 'does-not-exist.vrt')
    with pytest.raises(FileNotFoundError) as exc:
        reader._open()
    assert 'Friction VRT not found' in str(exc.value)


# ── admin-info — mocked probes ─────────────────────────────────────────────

def _mock_probes_ok(monkeypatch):
    class _Resp:
        status_code = 200
    monkeypatch.setattr(admin_mod.requests, 'get', lambda *a, **k: _Resp())

    class _Cur:
        def execute(self, *a): pass
        def fetchone(self): return (1,)
        def __enter__(self): return self
        def __exit__(self, *a): return False

    class _Conn:
        def cursor(self): return _Cur()
        def close(self): pass
    monkeypatch.setattr(admin_mod.psycopg2, 'connect', lambda *a, **k: _Conn())
    monkeypatch.setattr(admin_mod.subprocess, 'check_output', lambda *a, **k: 'osmium version 1.16.0\n')


def test_admin_info_auth_required(client):
    assert client.get('/api/admin/navi-offroute/info').status_code == 401


def test_admin_info_no_secrets_and_probes(client, monkeypatch):
    _mock_probes_ok(monkeypatch)
    d = client.get('/api/admin/navi-offroute/info', headers=AUTH).get_json()
    assert d['service'] == 'navi-offroute' and d['port'] == 8428
    # No masked secrets anywhere (Phase A §10 — none exist; DSN is peer-auth).
    assert all('...' not in str(e['value']) and e['value'] != '****' for e in d['env'])
    assert all('password' not in e['name'].lower() for e in d['env'])
    names = {dep['name'] for dep in d['dependencies']}
    assert names == {'valhalla', 'padus-postgis', 'osmium-tool'}
    # cheap file probes only (no row_count/size-of-db enrichment)
    fs_names = {f['name'] for f in d['filesystem']}
    assert {'dem', 'osm_pbf', 'navi_db', 'barriers_tif', 'wilderness_tif',
            'trails_tif', 'friction_vrt'} == fs_names
    assert all(set(f) == {'name', 'path', 'exists', 'readable'} for f in d['filesystem'])


# ── OffrouteRouter._route_auto — eligible-mode-set selection ──────────────
# Tested in isolation on a bare router (no __init__/readers): OffrouteRouter.route is
# monkeypatched per-mode; eligibility comes from category hints or a stubbed spatial
# fallback. Exercises _route_auto directly, not the Flask blueprint.

from services.navi_offroute.router import OffrouteRouter

ALL_MODES = frozenset({"vehicle", "4w", "2w", "foot"})


# ── _eligible_modes_from_category ─────────────────────────────────────────

def test_eligible_modes_exact_match():
    r = object.__new__(OffrouteRouter)
    assert r._eligible_modes_from_category("highway:residential") == ALL_MODES
    assert r._eligible_modes_from_category("highway:track") == frozenset({"4w", "2w", "foot"})
    assert r._eligible_modes_from_category("highway:path") == frozenset({"2w", "foot"})
    assert r._eligible_modes_from_category("highway:footway") == frozenset({"foot"})


def test_eligible_modes_wildcard_match():
    r = object.__new__(OffrouteRouter)
    # building:house -> building:* -> all modes
    assert r._eligible_modes_from_category("building:house") == ALL_MODES
    assert r._eligible_modes_from_category("amenity:cafe") == ALL_MODES
    # natural:* -> foot only
    assert r._eligible_modes_from_category("natural:peak") == frozenset({"foot"})


def test_eligible_modes_none_or_unknown():
    r = object.__new__(OffrouteRouter)
    assert r._eligible_modes_from_category(None) is None
    assert r._eligible_modes_from_category("") is None
    assert r._eligible_modes_from_category("bogus:thing") is None


# ── _spatial_eligible_modes — Valhalla classification.classification + .use ──
# _locate_on_network is monkeypatched to inject snap fixtures (road_class + use).

def _stub_locate_fixed(snap):
    def stub(self, lat, lon, mode="vehicle"):
        return dict(snap)
    return stub


def test_spatial_service_other_picks_vehicle(monkeypatch):
    # (a) paved grade "service_other" close in -> vehicle eligible (tight tier)
    snap = {"snap_distance_m": 3.0, "road_class": "service_other", "use": "road"}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert "vehicle" in modes
    assert modes == frozenset({"vehicle", "4w", "2w", "foot"})


def test_spatial_use_track_picks_atv_mtb_foot(monkeypatch):
    # (b) no road grade, use="track" -> atv/mtb/foot, NOT vehicle
    snap = {"snap_distance_m": 20.0, "road_class": None, "use": "track"}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert modes == frozenset({"4w", "2w", "foot"})
    assert "vehicle" not in modes


def test_spatial_use_footway_picks_mtb_foot(monkeypatch):
    # (c) no road grade, use="footway" -> mtb/foot (path, not track -> no atv)
    snap = {"snap_distance_m": 20.0, "road_class": None, "use": "footway"}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert modes == frozenset({"2w", "foot"})


def test_spatial_no_class_no_use_picks_foot(monkeypatch):
    # (d) nothing recognized -> foot only
    snap = {"snap_distance_m": 20.0, "road_class": None, "use": None}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert modes == frozenset({"foot"})


# ── EntryPointIndex.has_entry_points — EXISTS guard (replaces COUNT(*)) ────
# Bare index (no __init__/DB); table_exists + _get_conn monkeypatched.

from services.navi_offroute.router import EntryPointIndex


class _FakeCur:
    def __init__(self, row):
        self._row = row
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def execute(self, q, *a):
        self.q = q
    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, row):
        self._row = row
    def cursor(self):
        return _FakeCur(self._row)


def _bare_index(monkeypatch, table_exists, row=None):
    monkeypatch.setattr(EntryPointIndex, "table_exists", lambda self: table_exists)
    monkeypatch.setattr(EntryPointIndex, "_get_conn", lambda self: _FakeConn(row))
    return object.__new__(EntryPointIndex)


def test_has_entry_points_table_missing(monkeypatch):
    idx = _bare_index(monkeypatch, table_exists=False)
    assert idx.has_entry_points() is False


def test_has_entry_points_empty(monkeypatch):
    idx = _bare_index(monkeypatch, table_exists=True, row=(False,))
    assert idx.has_entry_points() is False


def test_has_entry_points_rows(monkeypatch):
    idx = _bare_index(monkeypatch, table_exists=True, row=(True,))
    assert idx.has_entry_points() is True


# ── EntryPointIndex.query_radius — k-NN <-> ordering + radius soft cap ─────

class _FakeCurQ:
    def __init__(self, rows, capture):
        self._rows, self._capture = rows, capture
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def execute(self, q, params=None):
        self._capture["query"] = q
        self._capture["params"] = params
    def fetchall(self):
        return self._rows


class _FakeConnQ:
    def __init__(self, rows, capture):
        self._rows, self._capture = rows, capture
    def cursor(self, cursor_factory=None):
        return _FakeCurQ(self._rows, self._capture)


def test_query_radius_uses_knn_sql(monkeypatch):
    cap = {}
    monkeypatch.setattr(EntryPointIndex, "table_exists", lambda self: True)
    monkeypatch.setattr(EntryPointIndex, "_get_conn", lambda self: _FakeConnQ([], cap))
    idx = object.__new__(EntryPointIndex)
    idx.query_radius(44.1, -115.0, 50, limit=10)
    assert "<->" in cap["query"]
    assert "LIMIT" in cap["query"]
    assert "ST_DWithin" not in cap["query"]  # radius scan removed


def test_query_radius_soft_cap_filters_beyond_radius(monkeypatch):
    rows = [
        {"id": 1, "distance_m": 100.0},
        {"id": 2, "distance_m": 50000.0},
        {"id": 3, "distance_m": 200000.0},  # beyond 50km cap -> dropped
    ]
    monkeypatch.setattr(EntryPointIndex, "table_exists", lambda self: True)
    monkeypatch.setattr(EntryPointIndex, "_get_conn", lambda self: _FakeConnQ(rows, {}))
    idx = object.__new__(EntryPointIndex)
    out = idx.query_radius(44.1, -115.0, 50, limit=10)  # 50 km = 50000 m cap
    assert [r["id"] for r in out] == [1, 2]


# ── Anisotropic A* pathfinder (#17+#18) ───────────────────────────────────
import numpy as _np
import services.navi_offroute.router as _router_mod
from services.navi_offroute.astar import (
    _speed_kmh, astar_multigoal, inflate_cost_multiplier,
)
from services.navi_offroute.cost import compute_cost_multiplier_grid

_MG = float(_np.tan(_np.radians(40.0)))


def test_signed_tobler_asymmetry():
    # Same magnitude, opposite sign -> downhill faster than uphill; peak near -0.05.
    up = _speed_kmh(0.2, 0, 6.0, _MG)
    down = _speed_kmh(-0.2, 0, 6.0, _MG)
    assert down > up
    peak = _speed_kmh(-0.05, 0, 6.0, _MG)
    assert peak >= _speed_kmh(0.0, 0, 6.0, _MG)
    assert peak >= _speed_kmh(-0.15, 0, 6.0, _MG)


def test_inflation_bumps_neighbors_and_preserves_inf():
    grid = _np.ones((30, 30), dtype=_np.float64)
    grid[15, 15] = 100.0  # high finite cost
    out = inflate_cost_multiplier(grid)
    assert out[15, 16] > 1.0          # neighbor inflated
    assert out[0, 0] < 1.05           # far corner ~baseline

    grid2 = _np.ones((30, 30), dtype=_np.float64)
    grid2[15, 15] = _np.inf           # impassable
    out2 = inflate_cost_multiplier(grid2)
    assert _np.isinf(out2[15, 15])    # inf preserved exactly
    assert _np.isfinite(out2[15, 16]) and out2[15, 16] > 1.0  # neighbor bumped, not inf


def _flat_inputs(n):
    elev = _np.zeros((n, n), dtype=_np.float64)
    mult = _np.ones((n, n), dtype=_np.float64)
    trail = _np.zeros((n, n), dtype=_np.uint8)
    lookup = _np.full(256, _np.inf, dtype=_np.float64)
    barr = _np.zeros((n, n), dtype=_np.uint8)
    return elev, mult, trail, lookup, barr


def test_astar_small_synthetic_shortest_path():
    elev, mult, trail, lookup, barr = _flat_inputs(30)
    gr = _np.array([29], dtype=_np.int64)
    gc = _np.array([29], dtype=_np.int64)
    idx, path, cost = astar_multigoal(
        mult, elev, 30.0, 30.0, _MG, 0, 6.0, trail, lookup, barr, 2, 0, 0, gr, gc)
    assert idx == 0
    assert tuple(path[0]) == (0, 0)
    assert tuple(path[-1]) == (29, 29)
    assert len(path) == 30  # pure diagonal on a flat grid
    assert cost > 0 and _np.isfinite(cost)


def test_astar_multigoal_picks_cheaper():
    elev, mult, trail, lookup, barr = _flat_inputs(30)
    gr = _np.array([0, 20], dtype=_np.int64)   # goal0 at (0,5) near; goal1 at (20,20) far
    gc = _np.array([5, 20], dtype=_np.int64)
    idx, path, cost = astar_multigoal(
        mult, elev, 30.0, 30.0, _MG, 0, 6.0, trail, lookup, barr, 2, 0, 0, gr, gc)
    assert idx == 0
    assert tuple(path[-1]) == (0, 5)


def test_compute_cost_multiplier_grid_math():
    elev = _np.zeros((4, 4), dtype=_np.float64)
    friction = _np.full((4, 4), 2.0, dtype=_np.float64)
    # mtb override: grass(30)=2.0, water(80)=inf
    fr = _np.full((4, 4), 30, dtype=_np.uint8)
    fr[0, 0] = 80
    mult = compute_cost_multiplier_grid(
        elev, 30.0, 30.0, friction=friction, friction_raw=fr, wilderness=None, mode="2w")
    assert mult[1, 1] == 4.0          # 2.0 friction * 2.0 grass override
    assert _np.isinf(mult[0, 0])      # water impassable


# ── _pathfind_wilderness mode wiring (mtb profile -> herzog + mtb trail set) ──

class _FakeDEM:
    def get_elevation_grid(self, south, north, west, east):
        return _np.zeros((10, 10), dtype=_np.float64), {"cell_size_m": 30.0}
    def latlon_to_pixel(self, lat, lon, meta):
        return (0, 0) if lat == 44.0 else (9, 9)
    def pixel_to_latlon(self, row, col, meta):
        return (44.0 + row * 0.001, -115.0 + col * 0.001)


class _FakeGrid:
    def __init__(self, val, dtype):
        self.val, self.dtype = val, dtype
    def _grid(self, **k):
        return _np.full((10, 10), self.val, dtype=self.dtype)


def test_pathfind_wilderness_always_uses_foot_effort(monkeypatch):
    # Even when called with mode="2w", the wilderness cost is computed as foot:
    # compute_cost_multiplier_grid receives mode="foot", and A* gets the foot speed
    # function (tobler=0), foot base speed (6.0), and foot trail friction.
    captured = {}

    def fake_mult(elevation, cell_size_lat_m, cell_size_lon_m,
                  friction=None, friction_raw=None, wilderness=None, mode="foot"):
        captured["mult_mode"] = mode
        return _np.ones((10, 10), dtype=_np.float64)

    def fake_astar(cost_mult, elevation, clat, clon, max_grade, sfid, base, trails,
                   lookup, barriers, bmid, orow, ocol, grows, gcols):
        captured["speed_function_id"] = sfid
        captured["base_speed"] = base
        captured["lookup"] = lookup
        return 0, _np.array([[0, 0], [9, 9]], dtype=_np.int64), 6.0

    monkeypatch.setattr(_router_mod, "compute_cost_multiplier_grid", fake_mult)
    monkeypatch.setattr(_router_mod, "astar_multigoal", fake_astar)
    monkeypatch.setattr(OffrouteRouter, "_init_readers", lambda self: None)

    r = object.__new__(OffrouteRouter)
    r.dem_reader = _FakeDEM()
    r.friction_reader = type("F", (), {"get_friction_grid": lambda self, **k: _np.full((10, 10), 30, dtype=_np.uint8)})()
    r.barrier_reader = type("B", (), {"get_barrier_grid": lambda self, **k: _np.zeros((10, 10), dtype=_np.uint8)})()
    r.trail_reader = type("T", (), {"get_trails_grid": lambda self, **k: _np.zeros((10, 10), dtype=_np.uint8)})()
    r.wilderness_reader = None  # foot is not wilderness_impassable -> not loaded anyway

    ep = [{"lat": 44.001, "lon": -115.001, "highway_class": "track", "name": "t", "land_status": "open"}]
    out = r._pathfind_wilderness(44.0, -115.0, 44.001, -115.001, ep, "pragmatic", "start", mode="2w")

    assert out["status"] == "ok"
    assert captured["mult_mode"] == "foot"        # cost grid built as foot despite mode=2w
    assert captured["speed_function_id"] == 0     # tobler (foot)
    assert captured["base_speed"] == 6.0          # foot base speed
    assert captured["lookup"][5] == 0.1           # foot road
    assert captured["lookup"][15] == 0.3          # foot track
    assert captured["lookup"][25] == 0.5          # foot foot-trail


# ── Smooth max_grade penalty (#19) ────────────────────────────────────────
from services.navi_offroute.astar import SLOPE_PENALTY_CAP as _CAP  # noqa: F401


def test_smooth_max_grade_penalty():
    # 5x5 wall across row 2 with one crossing gap at (2,0) (the cliff cell); diagonal
    # dodges of (2,0) are blocked so the gap can only be crossed via the penalised
    # vertical edges. A second gap at (2,4) is opened only for the "routes around" case.
    mg = float(_np.tan(_np.radians(40.0)))

    def run(bump, second_gap):
        elev = _np.zeros((5, 5), dtype=_np.float64)
        elev[2, 0] = bump
        mult = _np.ones((5, 5), dtype=_np.float64)
        for c in (1, 2, 3):
            mult[2, c] = _np.inf
        if not second_gap:
            mult[2, 4] = _np.inf          # close the detour: (2,0) is the only crossing
        mult[1, 1] = _np.inf              # block diagonal dodge into (2,0)
        mult[3, 1] = _np.inf              # block diagonal dodge out of (2,0)
        trail = _np.zeros((5, 5), dtype=_np.uint8)
        lookup = _np.full(256, _np.inf, dtype=_np.float64)
        barr = _np.zeros((5, 5), dtype=_np.uint8)
        gr = _np.array([4], dtype=_np.int64)
        gc = _np.array([0], dtype=_np.int64)
        return astar_multigoal(mult, elev, 30.0, 30.0, mg, 0, 6.0,
                               trail, lookup, barr, 2, 0, 0, gr, gc)

    def cells(path):
        return {tuple(int(x) for x in p) for p in path}

    # Flat control (only gap): crosses (2,0).
    idx0, p0, c0 = run(0.0, second_gap=False)
    assert idx0 == 0 and (2, 0) in cells(p0)

    # Moderate cliff (grade ~0.87 > max 0.84), no alternative: the smooth penalty lets A*
    # TRAVERSE it (a hard cliff would have returned no path) at a finite, raised cost.
    idxm, pm, cm = run(26.0, second_gap=False)
    assert idxm == 0 and (2, 0) in cells(pm)
    assert _np.isfinite(cm) and cm > c0

    # Absurd grade (~10) past the cap is still truly impassable: no alternative -> no path.
    idxa, pa, ca = run(300.0, second_gap=False)
    assert idxa == -1

    # ...but when an alternative exists, A* routes AROUND the impassable cliff cell.
    idxr, pr, cr = run(300.0, second_gap=True)
    assert idxr == 0 and (2, 0) not in cells(pr) and (2, 4) in cells(pr)


def test_signed_grade_at_max_threshold():
    # A cell at EXACTLY max_grade incurs no penalty (the ramp is on the overshoot).
    mg = 0.5
    elev = _np.zeros((2, 1), dtype=_np.float64)
    elev[1, 0] = mg * 30.0  # rise/run = 15/30 = 0.5 == mg exactly
    mult = _np.ones((2, 1), dtype=_np.float64)
    trail = _np.zeros((2, 1), dtype=_np.uint8)
    lookup = _np.full(256, _np.inf, dtype=_np.float64)
    barr = _np.zeros((2, 1), dtype=_np.uint8)
    gr = _np.array([1], dtype=_np.int64)
    gc = _np.array([0], dtype=_np.int64)
    idx, path, cost = astar_multigoal(mult, elev, 30.0, 30.0, mg, 0, 6.0,
                                      trail, lookup, barr, 2, 0, 0, gr, gc)
    expected = 30.0 * 3.6 / _speed_kmh(mg, 0, 6.0, mg)  # penalty = 1.0 at threshold
    assert idx == 0
    assert abs(cost - expected) < 1e-6


# ── Tighter wilderness bbox (#20): 5 entry points + 1.5 km pad ─────────────

def test_route_a_slices_entry_points_to_five(monkeypatch):
    # query_radius yields 8; _route_A must hand _pathfind_wilderness at most 5.
    eps = [{"lat": 44.0 + i * 0.001, "lon": -115.0, "highway_class": "track",
            "name": str(i), "land_status": "open"} for i in range(8)]
    captured = {}

    def fake_pf(self, olat, olon, dlat, dlon, entry_points, boundary_mode, label, mode="foot"):
        captured["n"] = len(entry_points)
        return {"status": "error", "message": "stop"}

    monkeypatch.setattr(OffrouteRouter, "_pathfind_wilderness", fake_pf)
    r = object.__new__(OffrouteRouter)
    r.entry_index = type("I", (), {
        "has_entry_points": lambda self: True,
        "query_radius": lambda self, *a, **k: list(eps),
    })()
    out = r._route_A_wilderness_to_network(44.0, -115.0, 44.5, -115.5, "foot", "pragmatic")
    assert out["status"] == "error"
    assert captured["n"] == 5


def test_pathfind_wilderness_bbox_pad_is_1_5km(monkeypatch):
    # Capture the bbox passed to get_elevation_grid; with origin == the single entry point,
    # the span is purely the padding -> 0.015 deg (~1.5 km) on each side.
    bounds = {}

    class _CapDEM:
        def get_elevation_grid(self, south, north, west, east):
            bounds.update(south=south, north=north, west=west, east=east)
            return _np.zeros((10, 10), dtype=_np.float64), {"cell_size_m": 30.0}
        def latlon_to_pixel(self, lat, lon, meta):
            return (0, 0)
        def pixel_to_latlon(self, row, col, meta):
            return (44.0 + row * 0.001, -115.0 + col * 0.001)

    monkeypatch.setattr(_router_mod, "compute_cost_multiplier_grid",
                        lambda *a, **k: _np.ones((10, 10), dtype=_np.float64))
    monkeypatch.setattr(_router_mod, "astar_multigoal",
                        lambda *a, **k: (0, _np.array([[0, 0]], dtype=_np.int64), 5.0))
    monkeypatch.setattr(OffrouteRouter, "_init_readers", lambda self: None)

    r = object.__new__(OffrouteRouter)
    r.dem_reader = _CapDEM()
    r.friction_reader = type("F", (), {"get_friction_grid": lambda self, **k: _np.full((10, 10), 30, dtype=_np.uint8)})()
    r.barrier_reader = type("B", (), {"get_barrier_grid": lambda self, **k: _np.zeros((10, 10), dtype=_np.uint8)})()
    r.trail_reader = type("T", (), {"get_trails_grid": lambda self, **k: _np.zeros((10, 10), dtype=_np.uint8)})()
    r.wilderness_reader = None

    ep = [{"lat": 44.0, "lon": -115.0, "highway_class": "track", "name": "t", "land_status": "open"}]
    out = r._pathfind_wilderness(44.0, -115.0, 44.0, -115.0, ep, "pragmatic", "start", mode="foot")
    assert out["status"] == "ok"
    assert abs((bounds["north"] - 44.0) - 0.015) < 1e-9
    assert abs((44.0 - bounds["south"]) - 0.015) < 1e-9
    assert abs((bounds["east"] - (-115.0)) - 0.015) < 1e-9


# ── Multi-mode A* kernel (unified-graph Phase 2; spec §2.3 / §10 / §11) ───────
from services.navi_offroute.astar import astar_multigoal_multimode as _mm
from services.navi_offroute.cost import MODE_PROFILES as _PROFILES

_MODE_ORDER = ["foot", "2w", "4w", "vehicle"]   # spec §2.1 fixed index order
_SFID = {"tobler": 0, "herzog": 1, "linear": 2}


def _mode_param_arrays():
    """Per-mode 1D param arrays (foot,2w,4w,vehicle order) + trail_friction_stack
    [n_modes,256], built faithfully from MODE_PROFILES."""
    n = len(_MODE_ORDER)
    max_grade = _np.empty(n, dtype=_np.float64)
    sfid = _np.empty(n, dtype=_np.int64)
    base = _np.empty(n, dtype=_np.float64)
    tfs = _np.full((n, 256), _np.inf, dtype=_np.float64)
    for mi, name in enumerate(_MODE_ORDER):
        p = _PROFILES[name]
        max_grade[mi] = float(_np.tan(_np.radians(p.max_slope_deg)))
        sfid[mi] = _SFID[p.speed_function]
        base[mi] = p.base_speed_kmh
        for tv, fr in p.trail_friction.items():
            tfs[mi, tv] = _np.inf if fr is None else float(fr)
    return max_grade, sfid, base, tfs


def _empty_trans():
    z = _np.empty(0, dtype=_np.int64)
    return z, z.copy(), z.copy(), z.copy(), _np.empty(0, dtype=_np.float64)


def test_multimode_foot_only_parity():
    # foot-only, no transitions: the multimode kernel (1-mode stack) must reproduce
    # astar_multigoal exactly -- it is a strict superset.
    n = 8
    elev, mult, trail, lookup, barr = _flat_inputs(n)
    foot_mg = float(_np.tan(_np.radians(_PROFILES["foot"].max_slope_deg)))
    gr = _np.array([n - 1], dtype=_np.int64)
    gc = _np.array([n - 1], dtype=_np.int64)
    idx1, path1, cost1 = astar_multigoal(
        mult, elev, 30.0, 30.0, foot_mg, 0, 6.0, trail, lookup, barr, 2, 0, 0, gr, gc)

    stack = mult.reshape(n, n, 1).copy()
    tr, tc, tf, tt, tcost = _empty_trans()
    idx2, path2, cost2 = _mm(
        stack, elev, 30.0, 30.0,
        _np.array([foot_mg]), _np.array([0], dtype=_np.int64), _np.array([6.0]),
        trail, lookup.reshape(1, 256).copy(), barr, 2,
        0, 0, _np.array([0], dtype=_np.int64), gr, gc, _np.array([0], dtype=_np.int64),
        tr, tc, tf, tt, tcost)

    assert idx2 == idx1 == 0
    assert cost2 == pytest.approx(cost1, rel=1e-9, abs=1e-9)
    assert _np.array_equal(path2[:, :2], path1)   # same (row,col) sequence
    assert _np.all(path2[:, 2] == 0)              # all foot


def test_multimode_parking_switch():
    # Forest corridor (foot-only) -> parking cell -> open field where vehicle is
    # fast and foot is slow. The optimizer must switch foot->vehicle at the parking
    # cell and beat foot-only. The cost advantage is TERRAIN-driven (no trails / no
    # friction<1), which keeps the §10 heuristic admissible -- a road's <1 friction
    # would make effective speed exceed base speed and break the heuristic (a known
    # property of the inherited single-mode kernel too).
    rows, cols, road_start = 3, 50, 25
    elev = _np.zeros((rows, cols), dtype=_np.float64)
    n_modes = 4
    stack = _np.full((rows, cols, n_modes), _np.inf, dtype=_np.float64)
    stack[:, :, 0] = 1.0                       # foot: passable everywhere off-trail
    stack[:, road_start:cols, 3] = 1.0         # vehicle: drivable only in the open field
    trail = _np.zeros((rows, cols), dtype=_np.uint8)   # no trails anywhere
    max_grade, sfid, base, tfs = _mode_param_arrays()
    barr = _np.zeros((rows, cols), dtype=_np.uint8)

    gr = _np.array([1], dtype=_np.int64)
    gc = _np.array([cols - 1], dtype=_np.int64)
    pr, pc = 1, road_start         # parking cell, foot<->vehicle, 60 s each way
    tr = _np.array([pr, pr], dtype=_np.int64)
    tc = _np.array([pc, pc], dtype=_np.int64)
    tf = _np.array([0, 3], dtype=_np.int64)
    tt = _np.array([3, 0], dtype=_np.int64)
    tcost = _np.array([60.0, 60.0], dtype=_np.float64)
    om = _np.array([0], dtype=_np.int64)        # start on foot
    gm = _np.array([3, 0], dtype=_np.int64)     # finish vehicle or foot

    idx, path, cost = _mm(
        stack, elev, 30.0, 30.0, max_grade, sfid, base, trail, tfs, barr, 1,
        1, 0, om, gr, gc, gm, tr, tc, tf, tt, tcost)

    assert idx == 0
    modes = path[:, 2]
    assert modes[0] == 0 and modes[-1] == 3       # foot start, vehicle finish
    switches = [k for k in range(1, len(path)) if modes[k] != modes[k - 1]]
    assert len(switches) == 1                     # exactly one mode change
    sk = switches[0]
    assert modes[sk - 1] == 0 and modes[sk] == 3  # foot -> vehicle
    assert tuple(path[sk, :2]) == (pr, pc)        # at the parking cell
    assert tuple(path[sk - 1, :2]) == (pr, pc)    # same cell, mode-change edge

    tr0, tc0, tf0, tt0, tcost0 = _empty_trans()
    _, _, cost_foot_only = _mm(
        stack, elev, 30.0, 30.0, max_grade, sfid, base, trail, tfs, barr, 1,
        1, 0, _np.array([0], dtype=_np.int64), gr, gc, _np.array([0], dtype=_np.int64),
        tr0, tc0, tf0, tt0, tcost0)
    assert cost < cost_foot_only


def test_multimode_no_transitions_independent():
    # No transitions: the 4-mode search degrades to 4 independent single-mode
    # searches -- the winning path never changes mode, and its cost equals the
    # min over the four single-mode runs (vehicle wins on flat passable terrain).
    # Off-trail only (no friction<1) keeps the heuristic admissible.
    n = 12
    elev = _np.zeros((n, n), dtype=_np.float64)
    n_modes = 4
    stack = _np.ones((n, n, n_modes), dtype=_np.float64)  # all modes passable off-trail
    trail = _np.zeros((n, n), dtype=_np.uint8)            # no trails
    max_grade, sfid, base, tfs = _mode_param_arrays()
    barr = _np.zeros((n, n), dtype=_np.uint8)
    gr = _np.array([n - 1], dtype=_np.int64)
    gc = _np.array([n - 1], dtype=_np.int64)
    all_modes = _np.array([0, 1, 2, 3], dtype=_np.int64)
    tr, tc, tf, tt, tcost = _empty_trans()

    idx, path, cost = _mm(
        stack, elev, 30.0, 30.0, max_grade, sfid, base, trail, tfs, barr, 2,
        0, 0, all_modes, gr, gc, all_modes, tr, tc, tf, tt, tcost)

    assert _np.all(path[:, 2] == path[0, 2])       # single mode the whole way
    winning_mode = int(path[0, 2])

    single_costs = []
    for mi in range(4):
        _, _, c1 = astar_multigoal(
            stack[:, :, mi].copy(), elev, 30.0, 30.0,
            float(max_grade[mi]), int(sfid[mi]), float(base[mi]),
            trail, tfs[mi].copy(), barr, 2, 0, 0, gr, gc)
        single_costs.append(c1)
    assert cost == pytest.approx(min(single_costs), rel=1e-9, abs=1e-9)
    assert winning_mode == int(_np.argmin(single_costs))  # vehicle (fastest base)


def test_multimode_heuristic_admissibility():
    # §10 admissibility: h(r,c,m) must never exceed the true optimal remaining cost.
    # vehicle (global-fastest base) is an allowed goal mode, so max_goal_speed is the
    # global max -> h is a true lower bound. No trails (friction<1 would let a road
    # beat base speed), so effective speed <= base speed everywhere.
    rows, cols = 6, 10
    rng = _np.random.RandomState(0)
    elev = (rng.rand(rows, cols) * 20.0).astype(_np.float64)
    n_modes = 4
    stack = _np.ones((rows, cols, n_modes), dtype=_np.float64)
    stack[2:4, 3:6, 1] = _np.inf   # a forest block impassable to wheeled modes
    stack[2:4, 3:6, 2] = _np.inf
    stack[2:4, 3:6, 3] = _np.inf
    trail = _np.zeros((rows, cols), dtype=_np.uint8)
    max_grade, sfid, base, tfs = _mode_param_arrays()
    barr = _np.zeros((rows, cols), dtype=_np.uint8)
    gr = _np.array([rows - 1], dtype=_np.int64)
    gc = _np.array([cols - 1], dtype=_np.int64)
    gm = _np.array([0, 3], dtype=_np.int64)        # foot or vehicle finish
    tr = _np.array([0, 0], dtype=_np.int64)        # one foot<->vehicle transition
    tc = _np.array([5, 5], dtype=_np.int64)
    tf = _np.array([0, 3], dtype=_np.int64)
    tt = _np.array([3, 0], dtype=_np.int64)
    tcost = _np.array([60.0, 60.0], dtype=_np.float64)

    max_goal_speed = max(float(base[g]) for g in gm)

    sampled = 0
    for r in range(0, rows, 2):
        for c in range(0, cols, 3):
            for m in (0, 3):
                d = float(_np.hypot((r - (rows - 1)) * 30.0, (c - (cols - 1)) * 30.0))
                h = d * 3.6 / max_goal_speed
                # Oracle: same kernel with the heuristic disabled (Dijkstra), seeded
                # only from this state -> exact true remaining cost.
                _, _, true_cost = _mm(
                    stack, elev, 30.0, 30.0, max_grade, sfid, base, trail, tfs, barr, 2,
                    r, c, _np.array([m], dtype=_np.int64), gr, gc, gm,
                    tr, tc, tf, tt, tcost, True)
                if not _np.isfinite(true_cost):
                    continue
                assert h <= true_cost + 1e-6
                sampled += 1
    assert sampled > 0   # the sweep actually exercised reachable states


# ── PHASE 3 — unified cost layers + transition cells (cost.py + transitions.py) ──
import os as _os
import time as _time
import math as _math
import numpy as _p3np
from services.navi_offroute.cost import (
    compute_unified_cost_layers as _cu_layers,
    compute_cost_multiplier_grid as _ccmg,
)
from services.navi_offroute.astar import inflate_cost_multiplier as _inflate
import services.navi_offroute.transitions as _trans


def _p3_meta(rows, cols, cell_m=30.0):
    """Synthetic DEMReader-shape meta near lat 40 (mirrors shared/dem.py meta keys)."""
    dlat = cell_m / 111000.0
    dlon = cell_m / (111000.0 * _math.cos(_math.radians(40.0)))
    return {
        "bounds": (40.0, 40.0 + rows * dlat, -111.0, -111.0 + cols * dlon),
        "pixel_size_lat": -dlat,
        "pixel_size_lon": dlon,
        "origin_lat": 40.0 + rows * dlat,   # top edge (row 0)
        "origin_lon": -111.0,
        "cell_size_m": cell_m,
        "shape": (rows, cols),
    }


def test_unified_cost_layers_per_mode_parity():
    """cost_mult[mode] == inflate(compute_cost_multiplier_grid(mode)) for each mode."""
    rows, cols = 24, 30
    rng = _p3np.random.default_rng(7)
    elevation = (1000.0 + rng.normal(0, 30, (rows, cols))).astype(_p3np.float64)
    elevation[3, 4] = _p3np.nan                       # exercise inf handling
    friction = (1.0 + rng.random((rows, cols))).astype(_p3np.float64)
    friction_raw = rng.choice([10, 20, 30, 60], size=(rows, cols)).astype(_p3np.uint8)
    trails = _p3np.zeros((rows, cols), _p3np.uint8); trails[10, :] = 5
    wilderness = _p3np.zeros((rows, cols), _p3np.uint8); wilderness[0:3, 0:3] = 255
    meta = _p3_meta(rows, cols)
    cm = float(meta["cell_size_m"])
    layers = _cu_layers(
        elevation, friction, friction_raw, trails, wilderness, meta,
        modes=("foot", "2w", "4w", "vehicle"), boundary_mode="pragmatic",
        endpoint_line=None)
    assert set(layers["cost_mult"]) == {"foot", "2w", "4w", "vehicle"}
    assert layers["meta"]["boundary_mode"] == "pragmatic"
    for mode in ("foot", "2w", "4w", "vehicle"):
        expected = _inflate(_ccmg(
            elevation, cell_size_lat_m=cm, cell_size_lon_m=cm,
            friction=friction, friction_raw=friction_raw,
            wilderness=wilderness, mode=mode))
        got = layers["cost_mult"][mode]
        assert _p3np.array_equal(_p3np.isinf(got), _p3np.isinf(expected))
        fin = ~_p3np.isinf(expected)
        assert _p3np.allclose(got[fin], expected[fin])


def test_road_terminus_transitions_pure_raster():
    """A road row ending mid-grid yields foot↔vehicle termini at 60 s, no DB."""
    rows, cols = 10, 10
    trail_grid = _p3np.zeros((rows, cols), _p3np.uint8)
    trail_grid[5, 0:6] = 5                            # road cols 0..5; col 6 is off-network
    meta = _p3_meta(rows, cols)
    tuples = _trans.road_terminus_transitions(meta, trail_grid)
    cells = {}
    for (lat, lon, fm, tm, cost_s) in tuples:
        cells.setdefault(_trans._latlon_to_pixel(lat, lon, meta), []).append((fm, tm, cost_s))
    assert set(cells) == {(5, c) for c in range(6)}  # all row-5 road cells border off-network
    f, v = _trans.MODE_INDEX["foot"], _trans.MODE_INDEX["vehicle"]
    for edges in cells.values():
        assert sorted(edges) == sorted([(f, v, 60.0), (v, f, 60.0)])


def test_transition_cap_closest_15(monkeypatch):
    """>15 parking lots within 5 km -> only the closest 15 (by perp distance) survive."""
    line = ((40.0, -111.0), (40.0, -110.0))           # ~east-west; lat offset = perp distance, all <5 km
    records = [{"lat": 40.0 + 0.0005 * k, "lon": -110.5, "name": f"P{k}", "access": "yes"}
               for k in range(1, 21)]

    class _StubParking:
        def query_parking_near_line(self, coords, buffer_m=2000):
            return records
    monkeypatch.setattr(_trans, "load_parking_index", lambda *a, **k: _StubParking())
    raw = _trans.parking_transitions_near_line(line, buffer_m=5000)
    capped = _trans._cap_candidates(raw, line)
    surviving_lats = sorted({round(t[0], 6) for t in capped})
    expected_lats = sorted({round(40.0 + 0.0005 * k, 6) for k in range(1, 16)})
    assert surviving_lats == expected_lats            # the closest 15 points
    assert len(capped) == 15 * 6                      # 6 directed tuples per lot


def test_cap_candidates_vectorized_matches_scalar_oracle():
    """O2a safety net: the vectorized _cap_candidates must select the SAME set as the scalar
    reference. Oracle = the original group/score/filter/sort/take-K loop using the retained
    scalar _cross_track_distance_m. 200 points on an east-west line at strictly increasing
    perpendicular offsets (no boundary ties), straddling the 5 km radius; 2 tuples/point."""
    line = ((40.0, -111.0), (40.0, -110.0))           # east-west at lat 40
    raw = []
    for i in range(200):
        lat = 40.0 + (i + 1) * 0.0008                 # perp dist ~ (i+1)*89 m -> ~56 within 5 km
        raw.append((lat, -110.5, 0, 3, 60.0))
        raw.append((lat, -110.5, 3, 0, 60.0))

    def oracle(raw, line):
        groups = {}
        for t in raw:
            groups.setdefault((t[0], t[1]), []).append(t)
        scored = []
        for (la, lo), tuples in groups.items():
            d = _trans._cross_track_distance_m(la, lo, line)
            if d <= _trans._CAP_RADIUS_M:
                scored.append((d, tuples))
        scored.sort(key=lambda x: x[0])
        out = []
        for _d, tuples in scored[:_trans._CAP_PER_TYPE]:
            out.extend(tuples)
        return out

    vec = _trans._cap_candidates(raw, line)
    orc = oracle(raw, line)
    assert set(vec) == set(orc)
    assert len(vec) == len(orc) == _trans._CAP_PER_TYPE * 2   # 15 closest points x 2 tuples


def test_compute_unified_cost_layers_perf():
    """≤1 s to build 4 cost layers + transition cells for a ~50 km bbox (spec §5 gate).
    Requires the real parking/trailhead DBs + a reachable Valhalla; skips otherwise."""
    from services.navi_offroute.mvum_parking import parking_db_path
    from services.navi_offroute.mvum import navi_db_path

    valhalla_url = _os.environ.get("NAVI_OFFROUTE_VALHALLA_URL", "http://localhost:8002")
    if not (_os.path.exists(parking_db_path()) and _os.path.exists(navi_db_path())):
        pytest.skip("parking/trailhead DBs not present locally — skipping perf gate")
    try:
        import requests
        requests.get(f"{valhalla_url}/status", timeout=1).raise_for_status()
    except Exception as e:
        pytest.skip(f"Valhalla not reachable at {valhalla_url}: {e}")

    cell_m = 30.0
    n = int(50_000 / cell_m)                          # ~50 km / 30 m
    elevation = _p3np.full((n, n), 1000.0, dtype=_p3np.float64)
    friction = _p3np.ones((n, n), dtype=_p3np.float64)
    friction_raw = _p3np.full((n, n), 30, dtype=_p3np.uint8)
    trails = _p3np.zeros((n, n), _p3np.uint8); trails[n // 2, :] = 5
    wilderness = _p3np.zeros((n, n), _p3np.uint8)
    meta = _p3_meta(n, n, cell_m)
    south, north, west, east = meta["bounds"]
    t0 = _time.perf_counter()
    layers = _cu_layers(
        elevation, friction, friction_raw, trails, wilderness, meta,
        modes=("foot", "2w", "4w", "vehicle"), boundary_mode="pragmatic",
        endpoint_line=((south, west), (north, east)), valhalla_url=valhalla_url)
    elapsed = _time.perf_counter() - t0
    assert set(layers["cost_mult"]) == {"foot", "2w", "4w", "vehicle"}
    assert elapsed <= 1.0, f"unified cost layers build took {elapsed:.3f}s > 1.0s"


# ── PHASE 4 — unified-graph _route_auto integration ───────────────────────────
# Hermetic: stub reader objects feed synthetic rasters, the REAL multimode kernel runs,
# transition DBs + MVUM + Valhalla are monkeypatched to deterministic empties.
import numpy as _p4np
import services.navi_offroute.router as _p4router
import services.navi_offroute.transitions as _p4trans
from services.navi_offroute.router import OffrouteRouter as _P4Router, MODE_ORDER as _MO
from services.navi_offroute.transitions import (_latlon_to_pixel as _ll2px,
                                                _pixel_to_latlon as _px2ll)
from services.navi_offroute.astar import astar_multigoal_multimode as _mm4
from services.navi_offroute.cost import MODE_PROFILES as _MP4


def _p4_meta(rows, cols, cell_m=100.0):
    dlat = cell_m / 111000.0
    dlon = cell_m / (111000.0 * _math.cos(_math.radians(40.0)))
    return {"bounds": (40.0, 40.0 + rows * dlat, -111.0, -111.0 + cols * dlon),
            "pixel_size_lat": -dlat, "pixel_size_lon": dlon,
            "origin_lat": 40.0 + rows * dlat, "origin_lon": -111.0,
            "cell_size_m": cell_m, "shape": (rows, cols)}


class _Grid:
    def __init__(self, arr): self._arr = arr
    def get_friction_grid(self, **kw): return self._arr
    def get_barrier_grid(self, **kw): return self._arr
    def get_trails_grid(self, **kw): return self._arr
    def get_wilderness_grid(self, **kw): return self._arr
    def close(self): pass


class _StubDem:
    def __init__(self, elevation, meta): self._e, self._m = elevation, meta
    def get_elevation_grid(self, **kw): return self._e, self._m
    def latlon_to_pixel(self, lat, lon, meta): return _ll2px(lat, lon, meta)
    def pixel_to_latlon(self, row, col, meta): return _px2ll(row, col, meta)
    def close(self): pass


class _StubIdx:
    def __init__(self, recs): self._r = recs or []
    def query_parking_near_line(self, coords, buffer_m=2000): return self._r
    def query_trailheads_near_line(self, coords, buffer_m=2000): return self._r


def _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, eligible):
    """An OffrouteRouter wired with synthetic rasters + deterministic-empty DBs/MVUM.
    `eligible(lat, lon) -> frozenset` supplies the per-endpoint seed modes (spatial probe)."""
    r = _P4Router()
    r.dem_reader = _StubDem(elevation.astype(_p4np.float64), meta)
    r.friction_reader = _Grid(friction_raw)
    r.barrier_reader = _Grid(barriers)
    r.trail_reader = _Grid(trails)
    r.wilderness_reader = _Grid(_p4np.zeros_like(barriers))
    monkeypatch.setattr(_p4router, "get_mvum_access_grid",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no mvum db")))
    monkeypatch.setattr(_p4trans, "load_parking_index", lambda *a, **k: _StubIdx([]))
    monkeypatch.setattr(_p4trans, "load_trailheads", lambda *a, **k: _StubIdx([]))
    monkeypatch.setattr(_p4trans, "get_surface_change_candidates", lambda *a, **k: [])
    monkeypatch.setattr(_P4Router, "_spatial_eligible_modes",
                        lambda self, lat, lon, cache: eligible(lat, lon))
    return r


def _unified_segments(result):
    return [f for f in result["route"]["features"]
            if (f["properties"] or {}).get("segment_type") == "unified"]


def _transition_feats(result):
    return [f for f in result["route"]["features"]
            if (f["properties"] or {}).get("segment_type") == "transition"]


def test_route_auto_wilderness_to_home_walk_then_drive(monkeypatch):
    # §1 failure case: wilderness start (foot-only) -> long road to an addressed end.
    rows, cols = 3, 40
    elevation = _p4np.full((rows, cols), 1000.0)
    friction_raw = _p4np.full((rows, cols), 10, dtype=_p4np.uint8)   # forest: foot ok, vehicle inf
    trails = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    trails[1, 8:40] = 5                                              # road from col 8 -> terminus at 8
    barriers = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    meta = _p4_meta(rows, cols)
    s_lat, s_lon = _px2ll(1, 0, meta)        # wilderness start
    e_lat, e_lon = _px2ll(1, 39, meta)       # on-road end
    elig = lambda lat, lon: (frozenset({"foot"}) if abs(lon - s_lon) < 1e-9
                             else frozenset({"foot", "2w", "4w", "vehicle"}))
    r = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)

    out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    assert out["status"] == "ok", out
    assert "foot" in out["selected_mode_set"] and "vehicle" in out["selected_mode_set"]
    segs = _unified_segments(out)
    assert segs[0]["properties"]["network_mode"] == "foot"
    assert segs[-1]["properties"]["network_mode"] == "vehicle"
    trans = _transition_feats(out)
    assert len(trans) == 1
    assert _ll2px(trans[0]["properties"]["lat"], trans[0]["properties"]["lon"], meta) == (1, 8)


def test_route_auto_foot_to_offpath(monkeypatch):
    rows, cols = 3, 12
    elevation = _p4np.full((rows, cols), 1000.0)
    friction_raw = _p4np.full((rows, cols), 30, dtype=_p4np.uint8)   # grass, foot passable
    trails = _p4np.zeros((rows, cols), dtype=_p4np.uint8)            # no network at all
    barriers = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    meta = _p4_meta(rows, cols)
    s_lat, s_lon = _px2ll(1, 0, meta)
    e_lat, e_lon = _px2ll(1, 11, meta)
    elig = lambda lat, lon: frozenset({"foot"})
    r = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)

    out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    assert out["status"] == "ok", out
    assert out["selected_mode_set"] == ["foot"]
    assert _transition_feats(out) == []
    assert all(s["properties"]["network_mode"] == "foot" for s in _unified_segments(out))


def test_route_auto_road_to_road(monkeypatch):
    rows, cols = 3, 20
    elevation = _p4np.full((rows, cols), 1000.0)
    friction_raw = _p4np.full((rows, cols), 10, dtype=_p4np.uint8)   # off-road forest (vehicle inf)
    trails = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    trails[1, :] = 5                                                 # road spans the grid
    barriers = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    meta = _p4_meta(rows, cols)
    s_lat, s_lon = _px2ll(1, 0, meta)
    e_lat, e_lon = _px2ll(1, 19, meta)
    elig = lambda lat, lon: frozenset({"foot", "2w", "4w", "vehicle"})
    r = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)

    out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    assert out["status"] == "ok", out
    assert "vehicle" in out["selected_mode_set"]
    # No off-network excursion: every combined-path cell sits on the road (trail != 0).
    combined = [f for f in out["route"]["features"]
                if f["properties"].get("segment_type") == "combined"][0]
    for lon, lat in combined["geometry"]["coordinates"]:
        rr, cc = _ll2px(lat, lon, meta)
        assert trails[rr, cc] != 0


def test_route_auto_heuristic_admissibility_road_case():
    # §10 fix: with a fast road (friction 0.1) the A* heuristic must stay admissible, so
    # the heuristic-guided cost equals the disable_heuristic=True (Dijkstra) cost.
    rows, cols, nm = 3, 20, 4
    elevation = _p4np.full((rows, cols), 1000.0)
    trail = _p4np.zeros((rows, cols), dtype=_p4np.uint8); trail[1, :] = 5
    stack = _p4np.full((rows, cols, nm), _p4np.inf)
    stack[:, :, 0] = 1.0                                            # foot passable off-trail
    tfs = _p4np.full((nm, 256), _p4np.inf)
    tfs[0, 5] = 0.1; tfs[3, 5] = 0.1                                # foot + vehicle on road
    mg = _p4np.array([_p4np.tan(_p4np.radians(_MP4[m].max_slope_deg)) for m in _MO])
    sfid = _p4np.array([{"tobler": 0, "herzog": 1, "linear": 2}[_MP4[m].speed_function]
                        for m in _MO], dtype=_p4np.int64)
    base = _p4np.array([_MP4[m].base_speed_kmh for m in _MO])
    barr = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    empty_i = _p4np.empty(0, dtype=_p4np.int64); empty_f = _p4np.empty(0, dtype=_p4np.float64)
    seed = _p4np.array([3], dtype=_p4np.int64)                     # vehicle origin + goal
    gr = _p4np.array([1], dtype=_p4np.int64); gc = _p4np.array([19], dtype=_p4np.int64)
    args = (stack, elevation, 100.0, 100.0, mg, sfid, base, trail, tfs, barr, 1,
            1, 0, seed, gr, gc, seed, empty_i, empty_i, empty_i, empty_i, empty_f)
    _, _, cost_h = _mm4(*args)
    _, _, cost_dijkstra = _mm4(*args, disable_heuristic=True)
    assert _p4np.isfinite(cost_h) and _p4np.isfinite(cost_dijkstra)
    assert cost_h <= cost_dijkstra + 1e-6


def test_route_auto_no_auto_fallback_from_field(monkeypatch):
    rows, cols = 3, 10
    elevation = _p4np.full((rows, cols), 1000.0)
    friction_raw = _p4np.full((rows, cols), 30, dtype=_p4np.uint8)
    trails = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    barriers = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    meta = _p4_meta(rows, cols)
    s_lat, s_lon = _px2ll(1, 0, meta); e_lat, e_lon = _px2ll(1, 9, meta)
    r = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta,
                     lambda lat, lon: frozenset({"foot"}))
    out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    assert out["status"] == "ok"
    assert "auto_fallback_from" not in out
    assert "auto_fallback_from" not in (out.get("summary") or {})


def _on_network_count(result, trails, meta):
    combined = [f for f in result["route"]["features"]
                if f["properties"].get("segment_type") == "combined"][0]
    n = 0
    for lon, lat in combined["geometry"]["coordinates"]:
        rr, cc = _ll2px(lat, lon, meta)
        if trails[rr, cc] != 0:
            n += 1
    return n


def test_route_auto_network_affinity_biases_path(monkeypatch):
    # Road (row 0, fast) vs flat grass field (drivable, slower). network_affinity > 1
    # penalises on-network edges; pushing it high across the modes biases the path off the
    # network. (foot is always an eligible seed, so a single-mode affinity is escaped by a
    # mode switch -- the bias must cover the modes that can ride the road.)
    rows, cols = 4, 14
    elevation = _p4np.full((rows, cols), 1000.0)
    friction_raw = _p4np.full((rows, cols), 30, dtype=_p4np.uint8)   # flat grass: off-road drivable
    trails = _p4np.zeros((rows, cols), dtype=_p4np.uint8); trails[0, :] = 5
    barriers = _p4np.zeros((rows, cols), dtype=_p4np.uint8)
    meta = _p4_meta(rows, cols)
    s_lat, s_lon = _px2ll(0, 0, meta); e_lat, e_lon = _px2ll(0, 13, meta)
    elig = lambda lat, lon: frozenset({"foot", "2w", "4w", "vehicle"})
    affinity = {m: 80.0 for m in ("foot", "2w", "4w", "vehicle")}

    r1 = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)
    base = r1._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    r2 = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)
    biased = r2._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic", network_affinity=affinity)
    assert base["status"] == "ok" and biased["status"] == "ok"
    assert _on_network_count(biased, trails, meta) < _on_network_count(base, trails, meta)


# ── PHASE 4.5 — corridor mask + parallel cost layers (perf) ───────────────────
import time as _p45time
from services.navi_offroute.cost import (compute_unified_cost_layers as _cu45,
                                          compute_cost_multiplier_grid as _ccmg45)
from services.navi_offroute.astar import inflate_cost_multiplier as _infl45


def _eq_with_inf(a, b):
    return _p4np.array_equal(_p4np.isinf(a), _p4np.isinf(b)) and _p4np.allclose(
        a[~_p4np.isinf(a)], b[~_p4np.isinf(b)])


def test_unified_cost_layers_parallel_matches_sequential():
    # The concurrent per-mode build must produce byte-identical layers to a serial
    # reference (and be deterministic run-to-run): catches threading-introduced bugs.
    rows, cols = 40, 50
    rng = _p4np.random.default_rng(11)
    elevation = (1000.0 + rng.normal(0, 40, (rows, cols))).astype(_p4np.float64)
    elevation[5, 6] = _p4np.nan
    friction = (1.0 + rng.random((rows, cols))).astype(_p4np.float64)
    friction_raw = rng.choice([10, 20, 30, 60], size=(rows, cols)).astype(_p4np.uint8)
    trails = _p4np.zeros((rows, cols), _p4np.uint8); trails[20, :] = 5
    wild = _p4np.zeros((rows, cols), _p4np.uint8)
    meta = _p4_meta(rows, cols)
    cm = float(meta["cell_size_m"])
    modes = ("foot", "2w", "4w", "vehicle")

    seq = {m: _infl45(_ccmg45(elevation, cell_size_lat_m=cm, cell_size_lon_m=cm,
                              friction=friction, friction_raw=friction_raw,
                              wilderness=wild, mode=m)) for m in modes}
    run1 = _cu45(elevation, friction, friction_raw, trails, wild, meta,
                 modes=modes, endpoint_line=None)["cost_mult"]
    run2 = _cu45(elevation, friction, friction_raw, trails, wild, meta,
                 modes=modes, endpoint_line=None)["cost_mult"]
    for m in modes:
        assert _eq_with_inf(run1[m], seq[m]), f"parallel != sequential for {m}"
        assert _eq_with_inf(run1[m], run2[m]), f"non-deterministic for {m}"


def test_route_auto_perf_under_5s(monkeypatch):
    # ~50 km synthetic grid (no DB/Valhalla): a full _route_auto must finish well under the
    # old wilderness-route wall-clock. Loose 5 s bound — a CI guard against kernel/cost-layer
    # regressions, exercising the corridor mask + parallel layers.
    n = 500                                            # 500 cells * 100 m = ~50 km/side
    elevation = _p4np.full((n, n), 1000.0)
    friction_raw = _p4np.full((n, n), 30, dtype=_p4np.uint8)   # grass: foot passable
    trails = _p4np.zeros((n, n), dtype=_p4np.uint8)
    barriers = _p4np.zeros((n, n), dtype=_p4np.uint8)
    meta = _p4_meta(n, n)
    s_lat, s_lon = _px2ll(250, 20, meta)
    e_lat, e_lon = _px2ll(250, 480, meta)              # ~46 km along row 250
    elig = lambda lat, lon: frozenset({"foot"})

    r = _auto_router(monkeypatch, elevation, friction_raw, trails, barriers, meta, elig)
    r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")          # warm JIT + caches
    t0 = _p45time.perf_counter()
    out = r._route_auto(s_lat, s_lon, e_lat, e_lon, "pragmatic")
    elapsed = _p45time.perf_counter() - t0
    assert out["status"] == "ok", out
    assert out["selected_mode_set"] == ["foot"]
    assert elapsed <= 5.0, f"_route_auto on ~50 km grid took {elapsed:.2f}s > 5.0s"


# ── Auto Valhalla bypass: pure road↔road skips the raster pipeline ────────────
import logging as _bp_logging


class _BypassOKResp:
    status_code = 200
    def json(self):
        return {"trip": {"legs": [{"shape": "", "maneuvers": []}],
                         "summary": {"length": 1.2, "time": 90}}}


class _BypassErrResp:
    status_code = 500
    text = "valhalla boom"


def _bp_fetch_should_not_run(*a, **k):
    raise AssertionError("_fetch_auto_rasters must NOT run when the bypass fires")


def _bp_fetch_sentinel(*a, **k):
    raise RuntimeError("FETCH_REACHED")   # proves we fell through to the unified flow


def test_route_auto_road_road_uses_valhalla_bypass(monkeypatch):
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_should_not_run)
    calls = []
    real_D = OffrouteRouter._route_D_network_only
    monkeypatch.setattr(OffrouteRouter, "_route_D_network_only",
                        lambda self, *a, **k: (calls.append(a) or real_D(self, *a, **k)))
    monkeypatch.setattr(_p4router.requests, "post", lambda *a, **k: _BypassOKResp())

    out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic",
                        start_category="highway:residential", end_category="highway:residential")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"
    assert out["selected_mode_set"] == ["vehicle"]
    assert out["summary"]["auto_bypass"] is True
    assert out["summary"]["scenario"] == "D"
    assert len(calls) == 1                              # _route_D_network_only called exactly once


def test_route_auto_road_offroad_skips_bypass(monkeypatch):
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_route_D_network_only",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("D must not run")))
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_sentinel)
    # start = paved road (vehicle eligible), end = footway (foot-only, no vehicle) -> no bypass.
    out = r._route_auto(42.5558, -114.4701, 42.5878, -114.5550, "pragmatic",
                        start_category="highway:residential", end_category="highway:footway")
    assert out["status"] == "error"
    assert "Failed to load terrain" in out["message"]   # reached _fetch_auto_rasters (unified flow)


def test_route_auto_untagged_skips_bypass(monkeypatch):
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes",
                        lambda self, lat, lon, cache: frozenset({"foot"}))
    monkeypatch.setattr(OffrouteRouter, "_route_D_network_only",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("D must not run")))
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_sentinel)
    out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic")  # no categories
    assert out["status"] == "error"
    assert "Failed to load terrain" in out["message"]   # bypass skipped, unified flow reached


def test_route_auto_bypass_falls_through_on_valhalla_error(monkeypatch, caplog):
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(_p4router.requests, "post", lambda *a, **k: _BypassErrResp())
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_sentinel)
    with caplog.at_level(_bp_logging.WARNING, logger="navi_offroute.router"):
        out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic",
                            start_category="highway:residential", end_category="highway:residential")
    assert "auto bypass attempted but Valhalla returned" in caplog.text
    assert out["status"] == "error"
    assert "Failed to load terrain" in out["message"]   # fell through to the unified flow
    assert "auto_bypass" not in (out.get("summary") or {})


# ── PR 47: bypass fires on untagged road clicks (tight snap), not relaxed/off-road ──

def _spatial_tight_paved(self, lat, lon, snap_cache):
    """Stub _spatial_eligible_modes: tight (3m) snap to a paved residential road, like a
    raw in-town map click ON the road. Populates snap_cache the way the real probe does."""
    snap_cache[(lat, lon, "auto")] = {"snap_distance_m": 3.0, "road_class": "residential",
                                      "use": "road", "on_network": True,
                                      "snapped_lat": lat, "snapped_lon": lon}
    return frozenset({"vehicle", "4w", "2w", "foot"})


def _spatial_relaxed_paved(self, lat, lon, snap_cache):
    """Stub: relaxed (50m) snap to a paved road + 'vehicle' eligibility (the flat-terrain
    grace). 50m > AUTO_SNAP_TIGHT_M, so _bypass_eligible must reject this."""
    snap_cache[(lat, lon, "auto")] = {"snap_distance_m": 50.0, "road_class": "residential",
                                      "use": "road", "on_network": True,
                                      "snapped_lat": lat, "snapped_lon": lon}
    return frozenset({"vehicle", "4w", "2w", "foot"})


def test_route_auto_untagged_tight_snap_fires_bypass(monkeypatch):
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes", _spatial_tight_paved)
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_should_not_run)
    monkeypatch.setattr(_p4router.requests, "post", lambda *a, **k: _BypassOKResp())
    out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic")  # no categories
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"
    assert out["summary"]["auto_bypass"] is True


def test_route_auto_untagged_relaxed_snap_fires_bypass(monkeypatch):
    # PR #48: a relaxed (50m) snap that still grants "vehicle" (paved + flat-terrain grace in
    # _spatial_eligible_modes) now fires the bypass -- we trust _auto_eligible_modes's judgment.
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes", _spatial_relaxed_paved)
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_should_not_run)
    monkeypatch.setattr(_p4router.requests, "post", lambda *a, **k: _BypassOKResp())
    out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic")  # no categories
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"
    assert out["summary"]["auto_bypass"] is True


def test_route_auto_untagged_no_vehicle_in_eligibility_skips_bypass(monkeypatch):
    # Safety gate (preserved from PR #47 test 6): when _spatial_eligible_modes withholds
    # "vehicle" -- e.g. _is_terrain_flat rejected a non-flat wilderness click near a road --
    # the bypass declines and the unified flow runs (preserving any walk-then-drive plan).
    r = object.__new__(OffrouteRouter)
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes",
                        lambda self, lat, lon, cache: frozenset({"foot"}))
    monkeypatch.setattr(OffrouteRouter, "_route_D_network_only",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("D must not run")))
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_sentinel)
    out = r._route_auto(42.5558, -114.4701, 42.5644, -114.4631, "pragmatic")  # no categories
    assert out["status"] == "error"
    assert "Failed to load terrain" in out["message"]   # no vehicle -> unified flow


def test_route_auto_e2e_http_in_town_fires_bypass(client, monkeypatch):
    # Full HTTP path through /api/offroute with the PRODUCTION request shape: NO categories.
    # This is the test that would have caught PR #46's wiring gap.
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes", _spatial_tight_paved)
    monkeypatch.setattr(OffrouteRouter, "_fetch_auto_rasters", _bp_fetch_should_not_run)
    monkeypatch.setattr(_p4router.requests, "post", lambda *a, **k: _BypassOKResp())
    resp = _post(client, {"start": [42.5558, -114.4701], "end": [42.5644, -114.4631],
                          "mode": "auto", "boundary_mode": "pragmatic"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["selected_mode"] == "vehicle"
    assert data["summary"]["auto_bypass"] is True


def test_mvum_cache_decode_once(monkeypatch):
    """O3a: the process-level decoded-feature cache decodes WKB once — a second call adds zero
    wkb.loads (cache hit). Skips without the real navi.db (e.g. matt-desktop)."""
    import services.navi_offroute.mvum as _mvum
    from services.navi_offroute.mvum import navi_db_path
    if not navi_db_path().exists():
        pytest.skip("navi.db not present locally")
    monkeypatch.setattr(_mvum, "_FEATURE_CACHE", None)        # force a cold build, auto-reverted
    n = [0]
    orig = _mvum.wkb.loads
    def counting(*a, **k):
        n[0] += 1
        return orig(*a, **k)
    monkeypatch.setattr(_mvum.wkb, "loads", counting)
    bbox = (43.5, 44.0, -115.0, -114.0)                       # Sawtooth NF area
    g1 = _mvum.get_mvum_access_grids_all_modes(*bbox, target_shape=(200, 200),
                                               modes=["mtb", "atv", "vehicle"])
    first = n[0]
    g2 = _mvum.get_mvum_access_grids_all_modes(*bbox, target_shape=(200, 200),
                                               modes=["mtb", "atv", "vehicle"])
    assert first > 0                                          # cold call decoded features
    assert n[0] == first                                      # warm call added ZERO decodes
    assert set(g1) == {"mtb", "atv", "vehicle"} and g1["atv"].shape == (200, 200)
