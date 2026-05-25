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

from services.navi_offroute.router import OffrouteRouter, AUTO_MODE_PRIORITY

ALL_MODES = frozenset({"vehicle", "atv", "mtb", "foot"})


def _stub_route(per_mode, calls):
    def stub(self, start_lat, start_lon, end_lat, end_lon, mode="foot", boundary_mode="pragmatic"):
        calls.append(mode)
        return dict(per_mode[mode])
    return stub


def _all_ok():
    return {m: {"status": "ok"} for m in AUTO_MODE_PRIORITY}


# ── _eligible_modes_from_category ─────────────────────────────────────────

def test_eligible_modes_exact_match():
    r = object.__new__(OffrouteRouter)
    assert r._eligible_modes_from_category("highway:residential") == ALL_MODES
    assert r._eligible_modes_from_category("highway:track") == frozenset({"atv", "mtb", "foot"})
    assert r._eligible_modes_from_category("highway:path") == frozenset({"mtb", "foot"})
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


# ── probe-iteration logic (both endpoints typed -> no spatial calls) ──────

def _typed_all(monkeypatch):
    monkeypatch.setattr(OffrouteRouter, "_eligible_modes_from_category",
                        lambda self, cat: ALL_MODES)


def test_route_auto_first_probe_ok_returns_vehicle(monkeypatch):
    _typed_all(monkeypatch)
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"
    assert out["selected_mode_set"] == sorted(ALL_MODES)
    assert calls == ["vehicle"]


def test_route_auto_falls_through_to_foot(monkeypatch):
    _typed_all(monkeypatch)
    calls = []
    per_mode = {
        "vehicle": {"status": "error", "message": "No roads found"},
        "atv": {"status": "error", "message": "No tracks found"},
        "mtb": {"status": "error", "message": "No tracks found"},
        "foot": {"status": "ok"},
    }
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "foot"
    assert calls == ["vehicle", "atv", "mtb", "foot"]


def test_route_auto_all_error_returns_error(monkeypatch):
    _typed_all(monkeypatch)
    calls = []
    per_mode = {m: {"status": "error", "message": f"{m} failed"} for m in AUTO_MODE_PRIORITY}
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "error"
    assert "selected_mode" not in out
    assert out["selected_mode_set"] == sorted(ALL_MODES)
    assert calls == ["vehicle", "atv", "mtb", "foot"]


def test_route_auto_selected_mode_present_in_ok_response(monkeypatch):
    _typed_all(monkeypatch)
    calls = []
    per_mode = {
        "vehicle": {"status": "error", "message": "No roads found"},
        "atv": {"status": "ok", "route": {"type": "FeatureCollection", "features": []}},
        "mtb": {"status": "ok"},
        "foot": {"status": "ok"},
    }
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "atv"


# ── _route_auto with category type hints (real _eligible_modes_from_category) ──

def test_route_auto_address_to_address_picks_vehicle(monkeypatch):
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category="highway:residential")
    assert out["selected_mode"] == "vehicle"
    assert calls == ["vehicle"]


def test_route_auto_address_to_trailhead_picks_atv(monkeypatch):
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category="highway:trailhead")
    assert out["selected_mode"] == "atv"
    assert "vehicle" not in calls
    assert out["selected_mode_set"] == sorted({"atv", "mtb", "foot"})


def test_route_auto_address_to_peak_picks_foot(monkeypatch):
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category="natural:peak")
    assert out["selected_mode"] == "foot"
    assert calls == ["foot"]
    assert out["selected_mode_set"] == ["foot"]


def test_route_auto_both_unknown_uses_spatial_fallback(monkeypatch):
    calls = []
    spatial_calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))

    def fake_spatial(self, lat, lon, snap_cache):
        spatial_calls.append((lat, lon))
        return ALL_MODES

    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes", fake_spatial)
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")  # no categories
    assert len(spatial_calls) == 2  # both endpoints resolved spatially
    assert out["selected_mode"] == "vehicle"


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
    assert modes == frozenset({"vehicle", "atv", "mtb", "foot"})


def test_spatial_use_track_picks_atv_mtb_foot(monkeypatch):
    # (b) no road grade, use="track" -> atv/mtb/foot, NOT vehicle
    snap = {"snap_distance_m": 20.0, "road_class": None, "use": "track"}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert modes == frozenset({"atv", "mtb", "foot"})
    assert "vehicle" not in modes


def test_spatial_use_footway_picks_mtb_foot(monkeypatch):
    # (c) no road grade, use="footway" -> mtb/foot (path, not track -> no atv)
    snap = {"snap_distance_m": 20.0, "road_class": None, "use": "footway"}
    monkeypatch.setattr(OffrouteRouter, "_locate_on_network", _stub_locate_fixed(snap))
    r = object.__new__(OffrouteRouter)
    modes = r._spatial_eligible_modes(43.6, -116.2, {})
    assert modes == frozenset({"mtb", "foot"})


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
