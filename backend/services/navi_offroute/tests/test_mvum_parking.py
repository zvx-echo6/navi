"""MVUM Layer 3b tests: OSMParkingIndex over a synthetic osm-parking.db."""
import sqlite3

import pytest

from services.navi_offroute.mvum_parking import OSMParkingIndex


def _parking_db(tmp_path, rows):
    """rows: list of (osm_id, osm_type, name, capacity, access, parking_type, lat, lon)."""
    db = tmp_path / "osm-parking.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE parking (id INTEGER PRIMARY KEY, osm_id TEXT, osm_type TEXT, "
        "name TEXT, capacity INTEGER, access TEXT, parking_type TEXT, "
        "lat REAL, lon REAL, shape BLOB)")
    conn.executemany(
        "INSERT INTO parking (osm_id,osm_type,name,capacity,access,parking_type,lat,lon) "
        "VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return db


def test_parking_index_loads(tmp_path):
    db = _parking_db(tmp_path, [
        ("1", "node", "Lot A", 20, None, "surface", 44.00, -114.00),
        ("2", "way", "Lot B", None, "yes", "surface", 44.01, -114.02),
        ("3", "way", "", None, "customers", None, 44.02, -114.03),
    ])
    idx = OSMParkingIndex(db_path=db)
    assert idx.count == 3
    assert len(idx.records) == idx.count == 3
    rec = idx.records[0]
    assert rec["name"] == "Lot A"
    assert rec["road_class"] == "parking"
    assert rec["parking_type"] == "surface"
    assert rec["lat"] == 44.00 and rec["lon"] == -114.00


def test_query_parking_near_line_returns_close_only(tmp_path):
    db = _parking_db(tmp_path, [
        ("1", "node", "On Line", None, None, "surface", 44.000, -114.000),
        ("2", "node", "Far Away", None, None, "surface", 44.300, -114.000),  # ~33 km N
    ])
    idx = OSMParkingIndex(db_path=db)
    line = [(44.000, -114.010), (44.000, -113.990)]  # ~1.6 km segment through the close pt
    near = idx.query_parking_near_line(line, buffer_m=2000)
    names = {r["name"] for r in near}
    assert "On Line" in names
    assert "Far Away" not in names


def test_private_parking_filtered_out(tmp_path):
    db = _parking_db(tmp_path, [
        ("1", "way", "Public", None, "yes", "surface", 44.00, -114.00),
        ("2", "way", "Private", None, "private", "surface", 44.01, -114.01),
        ("3", "way", "NoAccess", None, "no", "surface", 44.02, -114.02),
        ("4", "way", "PermitOnly", None, "permit", "surface", 44.03, -114.03),
    ])
    idx = OSMParkingIndex(db_path=db)
    names = {r["name"] for r in idx.records}
    assert names == {"Public"}
    assert idx.count == 1
    assert idx.skipped_access == 3


def test_no_access_field_kept(tmp_path):
    # Most OSM parking rows have NULL access -> must be kept (not treated as blocked).
    db = _parking_db(tmp_path, [
        ("1", "way", "Unspecified", None, None, "surface", 44.00, -114.00),
    ])
    idx = OSMParkingIndex(db_path=db)
    assert idx.count == 1
    assert idx.records[0]["access"] is None
