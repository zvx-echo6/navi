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

ALL_MODES = frozenset({"vehicle", "4w", "2w", "foot"})


def _stub_route(per_mode, calls):
    def stub(self, start_lat, start_lon, end_lat, end_lon, mode="foot", boundary_mode="pragmatic", **kwargs):
        calls.append(mode)
        return dict(per_mode[mode])
    return stub


def _all_ok():
    return {m: {"status": "ok"} for m in AUTO_MODE_PRIORITY}


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


# ── probe-iteration logic (both endpoints typed -> no spatial calls) ──────

def _typed_all(monkeypatch):
    monkeypatch.setattr(OffrouteRouter, "_eligible_modes_from_category",
                        lambda self, cat: ALL_MODES)


def test_route_auto_picks_capability_mode(monkeypatch):
    # Classify-once: typed road endpoints -> intersection = all modes -> the first
    # AUTO_MODE_PRIORITY mode (vehicle) is picked and routed ONCE (no 4-mode contest).
    _typed_all(monkeypatch)
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"
    assert out["selected_mode_set"] == sorted(ALL_MODES)
    assert calls == ["vehicle"]   # ONE route call, not four


def test_route_auto_falls_back_to_foot_on_error(monkeypatch):
    # Foot-as-last-resort: the capability-picked mode (vehicle) fails, so Auto retries
    # foot ONCE and ships it, tagging auto_fallback_from for the UI.
    _typed_all(monkeypatch)
    calls = []
    per_mode = {m: {"status": "error", "message": f"{m} failed"} for m in AUTO_MODE_PRIORITY}
    per_mode["foot"] = {"status": "ok"}
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "foot"
    assert out["auto_fallback_from"] == "vehicle"
    assert out["selected_mode_set"] == sorted(ALL_MODES)   # original eligibility, not foot-only
    assert calls == ["vehicle", "foot"]


def test_route_auto_returns_error_when_picked_and_foot_both_fail(monkeypatch):
    # Picked mode AND the foot fallback both fail -> original error surfaces, exactly
    # two attempts (picked, then foot).
    _typed_all(monkeypatch)
    calls = []
    per_mode = {m: {"status": "error", "message": f"{m} failed"} for m in AUTO_MODE_PRIORITY}
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "error"
    assert "selected_mode" not in out
    assert out["selected_mode_set"] == sorted(ALL_MODES)
    assert calls == ["vehicle", "foot"]


def test_route_auto_no_fallback_when_picked_is_foot(monkeypatch):
    # When the picked mode is already foot (foot-only intersection), there is no second
    # attempt -- foot cannot fall back to itself.
    calls = []
    per_mode = {"foot": {"status": "error", "message": "foot failed"}}
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category="natural:peak")  # -> {foot}
    assert out["status"] == "error"
    assert out["selected_mode_set"] == ["foot"]
    assert calls == ["foot"]   # no fallback attempt


def test_route_auto_tagged_road_to_road_no_spatial_probe(monkeypatch):
    # Tagged road endpoints -> pure category classification, the spatial probe must
    # NOT fire, and exactly one route call (mode=vehicle) is made.
    calls = []
    spatial_calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes",
                        lambda self, lat, lon, sc: spatial_calls.append((lat, lon)) or ALL_MODES)
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category="highway:residential")
    assert out["selected_mode"] == "vehicle"
    assert calls == ["vehicle"]
    assert spatial_calls == []   # no spatial probe for tagged endpoints


def test_route_auto_untagged_spatial_called_once_per_endpoint(monkeypatch):
    # One untagged endpoint -> _spatial_eligible_modes fires exactly once (for that
    # endpoint only); the tagged endpoint stays a dict lookup.
    calls = []
    spatial_calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    monkeypatch.setattr(OffrouteRouter, "_spatial_eligible_modes",
                        lambda self, lat, lon, sc: spatial_calls.append((lat, lon)) or ALL_MODES)
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic",
                        start_category="building:house", end_category=None)  # end untagged
    assert spatial_calls == [(42.5, -114.5)]   # exactly once, for the untagged end
    assert calls == ["vehicle"]


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
    assert out["selected_mode"] == "4w"
    assert calls == ["4w"]   # capability pick, single call
    assert out["selected_mode_set"] == sorted({"4w", "2w", "foot"})


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
    assert calls == ["vehicle"]   # one route after classification


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


# ── Auto classify-once priority pick (replaces the old min-time contest) ──

def test_route_auto_picks_priority_not_min_time(monkeypatch):
    # Classify-once picks the first AUTO_MODE_PRIORITY mode in the intersection
    # (vehicle) and routes ONCE -- it no longer probes all modes to find a faster one.
    # (The old min-time contest, where a slower-priority mode could win, is gone -- a
    # documented PR1 trade-off in auto-rewrite-plan.md.)
    _typed_all(monkeypatch)
    calls = []
    per_mode = {
        "vehicle": {"status": "ok", "summary": {"total_effort_minutes": 200.0}},
        "4w": {"status": "ok", "summary": {"total_effort_minutes": 50.0}},
        "2w": {"status": "ok", "summary": {"total_effort_minutes": 120.0}},
        "foot": {"status": "ok", "summary": {"total_effort_minutes": 800.0}},
    }
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(per_mode, calls))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["status"] == "ok"
    assert out["selected_mode"] == "vehicle"                  # first priority, picked by capability
    assert calls == ["vehicle"]                               # routed once, no contest


def test_route_auto_per_leg_breakdown():
    # Scenario A (_build_response): foot wilderness leg + network leg -> both > 0.
    r = object.__new__(OffrouteRouter)
    ws = [[-116.20, 43.60], [-116.21, 43.61]]
    ws_stats = {"effort_minutes": 12.0, "distance_km": 1.0, "elevation_gain_m": 10.0,
                "elevation_loss_m": 5.0, "on_trail_pct": 50.0, "barrier_crossings": 0}
    net = {"distance_km": 60.0, "duration_minutes": 45.0, "maneuvers": [],
           "coordinates": [[-116.21, 43.61], [-116.30, 43.70]]}
    out = r._build_response(ws, ws_stats, None, net, None, None, None,
                            "vehicle", "pragmatic", None, None, "A", 0.0, None)
    assert out["status"] == "ok"
    summ = out["summary"]
    assert summ["wilderness_minutes"] > 0
    assert summ["network_minutes"] > 0
    # approx adds up to total
    assert abs((summ["wilderness_minutes"] + summ["network_minutes"]) - summ["total_effort_minutes"]) < 1e-6


def test_route_auto_annotates_picked_mode_once(monkeypatch):
    # Classify-once routes the picked mode with annotate_mvum=False, then
    # _annotate_network_segments runs exactly once, on that picked mode (vehicle).
    _typed_all(monkeypatch)
    calls = []
    monkeypatch.setattr(OffrouteRouter, "route", _stub_route(_all_ok(), calls))
    annotated = []
    monkeypatch.setattr(OffrouteRouter, "_annotate_network_segments",
                        lambda self, result, mode: annotated.append(mode))
    r = object.__new__(OffrouteRouter)
    out = r._route_auto(42.0, -114.0, 42.5, -114.5, "pragmatic")
    assert out["selected_mode"] == "vehicle"
    assert calls == ["vehicle"]
    assert annotated == ["vehicle"]   # annotated once, on the picked mode


# ── Layer 3b: parking as a hybrid transition candidate source ──

def _hybrid_ok_leg(distance_km, minutes):
    return {
        "status": "ok",
        "route": {"type": "FeatureCollection", "features": [
            {"type": "Feature",
             "properties": {"segment_type": "network", "network_mode": "x"},
             "geometry": {"type": "LineString",
                          "coordinates": [[-114.0, 44.0], [-114.1, 44.0]]}},
        ]},
        "summary": {"total_distance_km": distance_km, "total_effort_minutes": minutes,
                    "network_distance_km": distance_km, "network_duration_minutes": minutes,
                    "wilderness_distance_km": 0.0, "wilderness_effort_minutes": 0.0,
                    "scenario": "D"},
    }


def _hybrid_winning_single_mode(distance_km, minutes):
    return {
        "status": "ok",
        "route": {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"segment_type": "combined"},
             "geometry": {"type": "LineString",
                          "coordinates": [[-114.0, 44.0], [-114.5, 44.0]]}},
        ]},
        "summary": {"total_distance_km": distance_km, "total_effort_minutes": minutes,
                    "scenario": "D"},
        "selected_mode": "vehicle",
    }


class _FakeParking:
    def __init__(self, records):
        self._records = records

    def query_parking_near_line(self, coords, buffer_m=2000):
        return list(self._records)


def test_hybrid_consumes_parking_candidates(monkeypatch):
    # Only the parking index supplies candidates (no trailhead index, no surface
    # changes); the parking lot must be probed as a leg-1 destination and win.
    parking = {"lat": 44.0, "lon": -114.25, "name": "BLM Trailhead Lot",
               "road_class": "parking", "parking_type": "surface", "access": None}
    monkeypatch.setattr("services.navi_offroute.router.get_surface_change_candidates",
                        lambda coords, url: [])

    seen_dests = []

    def fake_route(self, s_lat, s_lon, e_lat, e_lon, mode="foot",
                   boundary_mode="pragmatic", annotate_mvum=True, **k):
        seen_dests.append((round(e_lat, 4), round(e_lon, 4)))
        if mode == "vehicle":
            return _hybrid_ok_leg(12.0, 20.0)
        return _hybrid_ok_leg(4.0, 30.0)
    monkeypatch.setattr(OffrouteRouter, "route", fake_route)

    r = object.__new__(OffrouteRouter)
    r.spatial_index = None
    r.trailhead_index = None          # no trailheads -> parking must still be gathered
    r.parking_index = _FakeParking([parking])

    best = _hybrid_winning_single_mode(distance_km=30.0, minutes=120.0)
    out = r._try_hybrid_auto(44.0, -114.0, 44.0, -114.5, "pragmatic",
                             best, 120.0, frozenset({"vehicle", "4w", "2w", "foot"}))
    assert out is not None
    assert out["selected_mode"] == "hybrid"
    # the parking lot was probed as a drive-to (leg-1) destination
    assert (round(parking["lat"], 4), round(parking["lon"], 4)) in seen_dests
    trans = next(f for f in out["route"]["features"]
                 if f["properties"].get("kind") == "transition")
    assert trans["properties"]["name"] == "BLM Trailhead Lot"
