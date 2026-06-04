"""HPA tile-DB manifest pattern (hpa_manifest.py) unit tests."""
import json
import logging
import os

import pytest

from services.navi_offroute import hpa_manifest as hm


def _write(dirpath, payload):
    with open(os.path.join(dirpath, "manifest.json"), "w") as f:
        json.dump(payload, f)


def _touch(dirpath, name):
    p = os.path.join(dirpath, name)
    open(p, "w").close()
    return p


def test_chunk_bounds_intersects():
    cb = hm.ChunkBounds(min_x=-10, max_x=10, min_y=0, max_y=100)
    assert cb.intersects(0, 0, 50, 50)            # point inside
    assert cb.intersects(-20, -5, 50, 50)         # overlapping west edge
    assert cb.intersects(-10, 10, 0, 100)         # exact match (inclusive)
    assert not cb.intersects(11, 20, 50, 50)      # entirely east
    assert not cb.intersects(0, 5, 101, 200)      # entirely north


def test_load_from_dir_roundtrip_and_unbounded(tmp_path):
    a = _touch(str(tmp_path), "a.db"); _touch(str(tmp_path), "world.db")
    _write(str(tmp_path), {"version": 1, "tile_dbs": [
        {"name": "a", "path": "a.db",
         "chunk_bounds": {"min_x": -8550, "max_x": -8430, "min_y": 3100, "max_y": 3260}},
        {"name": "world", "path": "world.db", "chunk_bounds": None},
    ]})
    m = hm._load_from_dir(str(tmp_path))
    assert m.enabled() and len(m.entries) == 2
    assert m.entries[0].abs_path == a
    assert m.entries[0].chunk_bounds == hm.ChunkBounds(-8550, -8430, 3100, 3260)
    assert m.entries[1].chunk_bounds is None


def test_load_from_dir_fails_fast(tmp_path):
    # missing manifest -> FileNotFoundError
    with pytest.raises(FileNotFoundError, match="manifest not found"):
        hm._load_from_dir(str(tmp_path))
    # bad version -> ValueError
    _write(str(tmp_path), {"version": 99, "tile_dbs": []})
    with pytest.raises(ValueError, match="unsupported version"):
        hm._load_from_dir(str(tmp_path))
    # entry pointing at missing file -> FileNotFoundError
    _write(str(tmp_path), {"version": 1, "tile_dbs": [
        {"name": "ghost", "path": "ghost.db", "chunk_bounds": None}]})
    with pytest.raises(FileNotFoundError, match="ghost.db"):
        hm._load_from_dir(str(tmp_path))


def test_dbs_for_chunks_lookup(tmp_path):
    a = _touch(str(tmp_path), "a.db"); b = _touch(str(tmp_path), "b.db")
    w = _touch(str(tmp_path), "world.db")
    _write(str(tmp_path), {"version": 1, "tile_dbs": [
        {"name": "a", "path": "a.db",
         "chunk_bounds": {"min_x": 0, "max_x": 10, "min_y": 0, "max_y": 10}},
        {"name": "b", "path": "b.db",
         "chunk_bounds": {"min_x": 20, "max_x": 30, "min_y": 0, "max_y": 10}},
        {"name": "world", "path": "world.db", "chunk_bounds": None},
    ]})
    m = hm._load_from_dir(str(tmp_path))
    assert m.dbs_for_chunks(5, 5, 5, 5) == [a, w]          # hits a + unbounded
    assert m.dbs_for_chunks(25, 25, 5, 5) == [b, w]        # hits b + unbounded
    assert m.dbs_for_chunks(5, 25, 5, 5) == [a, b, w]      # straddles seam
    assert m.dbs_for_chunks(100, 200, 0, 0) == [w]         # only unbounded


def test_load_env_dir_wins_over_legacy(tmp_path, monkeypatch, caplog):
    _touch(str(tmp_path), "world.db")
    _write(str(tmp_path), {"version": 1, "tile_dbs": [
        {"name": "w", "path": "world.db", "chunk_bounds": None}]})
    legacy = _touch(str(tmp_path), "legacy.db")
    monkeypatch.setenv(hm.ENV_DIR, str(tmp_path))
    monkeypatch.setenv(hm.ENV_LEGACY, legacy)
    with caplog.at_level(logging.WARNING, logger="services.navi_offroute.hpa_manifest"):
        m = hm.load()
    assert [e.name for e in m.entries] == ["w"]
    assert "takes precedence" in caplog.text


def test_load_env_legacy_synthesizes_unbounded(tmp_path, monkeypatch, caplog):
    legacy = _touch(str(tmp_path), "legacy.db")
    monkeypatch.delenv(hm.ENV_DIR, raising=False)
    monkeypatch.setenv(hm.ENV_LEGACY, legacy)
    with caplog.at_level(logging.WARNING, logger="services.navi_offroute.hpa_manifest"):
        m = hm.load()
    assert len(m.entries) == 1 and m.entries[0].chunk_bounds is None
    assert m.entries[0].abs_path == legacy
    assert "deprecated" in caplog.text


def test_load_env_disabled_paths(tmp_path, monkeypatch):
    # legacy points at missing file -> empty
    monkeypatch.delenv(hm.ENV_DIR, raising=False)
    monkeypatch.setenv(hm.ENV_LEGACY, str(tmp_path / "nope.db"))
    assert not hm.load().enabled()
    # neither var set -> empty
    monkeypatch.delenv(hm.ENV_LEGACY, raising=False)
    assert not hm.load().enabled()
