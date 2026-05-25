"""MVUM spatial index foundation (Layer 0) tests.

Exercises MVUMSpatialIndex against the real navi.db on this host (read-only) and the
admin-info endpoint. Pure spatial lookup — no routing or response-format coverage.
"""
import pytest

from services.navi_offroute.mvum import MVUMSpatialIndex


@pytest.fixture(scope="module")
def index():
    return MVUMSpatialIndex()


def test_index_loads_without_error(index):
    assert index.road_count > 0
    assert index.trail_count > 0
    assert len(index.by_id) == index.road_count + index.trail_count
    assert len(index.bbox) == 4


def test_query_bbox_returns_features(index):
    # Generous Boise National Forest area bbox.
    feats = index.query_bbox(43.8, -116.3, 44.4, -115.5)
    assert len(feats) > 0
    assert all("geometry" in f and "feature_id" in f for f in feats)


def test_query_buffered_line_returns_features(index):
    # Take a point on an actual indexed feature and query a small buffer around it.
    sample = next(iter(index.by_id.values()))
    pt = sample["geometry"].representative_point()
    feats = index.query_buffered_line([(pt.y, pt.x)], tolerance_m=50)
    assert len(feats) >= 1


def test_admin_info_endpoint_returns_counts(index, monkeypatch):
    import services.navi_offroute.app as app_mod
    # Reuse the already-built fixture index instead of rebuilding in create_app.
    monkeypatch.setattr(app_mod, "MVUMSpatialIndex", lambda *a, **k: index)
    client = app_mod.create_app().test_client()
    resp = client.get("/api/admin/mvum-spatial/info",
                      headers={"X-Authentik-Username": "matt"})
    assert resp.status_code == 200
    d = resp.get_json()
    assert d["road_count"] > 0 and d["trail_count"] > 0
    assert len(d["bbox"]) == 4
    assert "build_time_seconds" in d and "memory_estimate_mb" in d
