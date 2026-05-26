#!/usr/bin/env python3
"""Ingest OSM amenity=parking into the OSM parking SQLite DB consumed by
navi-offroute's Layer 3b (mvum_parking.OSMParkingIndex).

Pipeline (see README-osm-parking-ingest.md):
  geofabrik <region>-latest.osm.pbf
    -> osmium tags-filter nwr/amenity=parking  -> <region>-parking.osm.pbf
    -> osmium export -f geojsonseq -a type,id   -> <region>-parking.geojsonseq
    -> THIS SCRIPT                              -> osm-parking.db

Reads the GeoJSONSeq stream (one RFC-8142 record per line, 0x1e-prefixed),
keeps only features tagged amenity=parking, and writes one row per parking
object: a Point for nodes, a (Multi)Polygon for closed-area ways/relations.

osmium export emits each closed area-way TWICE -- once as the raw LineString and
once as the assembled (Multi)Polygon -- so we drop Line geometries to keep a
single geometry per object (rare genuinely-open parking ways, which are data
errors, are dropped). lat/lon store an interior representative_point used by the
index to build its STRtree without re-parsing the WKB.
"""
import argparse
import json
import sqlite3

from shapely.geometry import shape
from shapely import to_wkb

DEFAULT_DB = "/mnt/nav/osm-parking.db"


def parse_capacity(v):
    """Leading-integer parse of an OSM capacity value (e.g. '120', '12;disabled'); None if non-numeric."""
    if v is None:
        return None
    digits = ""
    for ch in str(v):
        if ch.isdigit():
            digits += ch
        else:
            break
    return int(digits) if digits else None


def main():
    ap = argparse.ArgumentParser(description="Ingest amenity=parking GeoJSONSeq into osm-parking.db")
    ap.add_argument("--geojsonseq", required=True,
                    help="input GeoJSONSeq from `osmium export -f geojsonseq -a type,id`")
    ap.add_argument("--db", default=DEFAULT_DB,
                    help=f"output SQLite DB (default {DEFAULT_DB})")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA journal_mode=OFF")
    con.execute("PRAGMA synchronous=OFF")
    con.execute("DROP TABLE IF EXISTS parking")
    con.execute("""CREATE TABLE parking (
        id INTEGER PRIMARY KEY,
        osm_id TEXT, osm_type TEXT, name TEXT,
        capacity INTEGER, access TEXT, parking_type TEXT,
        lat REAL, lon REAL, shape BLOB)""")

    INS = ("INSERT INTO parking (osm_id,osm_type,name,capacity,access,parking_type,lat,lon,shape)"
           " VALUES (?,?,?,?,?,?,?,?,?)")

    batch, n, skipped, bad = [], 0, 0, 0
    with open(args.geojsonseq, "rb") as f:
        for raw in f:
            raw = raw.strip().lstrip(b"\x1e").strip()
            if not raw:
                continue
            try:
                feat = json.loads(raw)
            except Exception:
                bad += 1; continue
            props = feat.get("properties") or {}
            if props.get("amenity") != "parking":
                skipped += 1; continue
            gj = feat.get("geometry")
            if not gj:
                skipped += 1; continue
            try:
                geom = shape(gj)
                if geom.is_empty:
                    bad += 1; continue
                # Drop the duplicate LineString osmium emits for each closed area-way.
                if geom.geom_type in ("LineString", "MultiLineString"):
                    skipped += 1; continue
                rep = geom.representative_point()
                wkb = to_wkb(geom, output_dimension=2, byte_order=1)
            except Exception:
                bad += 1; continue
            batch.append((str(props.get("@id")), props.get("@type"), props.get("name"),
                          parse_capacity(props.get("capacity")), props.get("access"),
                          props.get("parking"), rep.y, rep.x, wkb))
            n += 1
            if len(batch) >= 5000:
                con.executemany(INS, batch); batch = []
    if batch:
        con.executemany(INS, batch)
    con.execute("CREATE INDEX idx_parking_latlon ON parking(lat, lon)")
    con.commit()
    print(f"inserted={n} skipped_non_parking_or_line={skipped} bad_geom={bad}")
    con.close()


if __name__ == "__main__":
    main()
