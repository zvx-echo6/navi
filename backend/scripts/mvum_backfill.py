#!/usr/bin/env python3
"""Backfill mvum_trails.shape from the USFS National Forest System Trails centerline.

Some forests publish MVUM trail records in Trans_MVUM_Trail with NULL geometry (the
national MVUM-trail rollup is geometry-sparse for parts of Regions 1 and 6). This script
recovers those geometries from a *different* USFS dataset — Trans_Trail_NFS_Publish (the
NFS trail centerlines) — and writes them into the empty mvum_trails.shape blobs.

DATA SOURCES (see README-mvum-ingest.md):
  navi.db            mvum_trails table (target; produced by the initial ogr2ogr ingest)
  --nfs-gdb          Trans_Trail_NFS_Publish.gdb  (USFS EDW; the geometry donor)

JOIN KEY: NFS feature matched to a null mvum_trails row by
  TRAIL_NO == mvum_trails.id  AND  TRAIL_NAME == mvum_trails.name,
scoped to the row's forest via the ADMIN_ORG region+forest 4-char prefix. The forest ->
prefix map is learned empirically from the *non-null* mvum_trails rows (join them to NFS
and record the prefixes their matches carry). Forests with no learnable prefix (e.g. a
forest that is 100% null, so has no non-null row to learn from) fall back to
name+number-only matching. Matched NFS segments are merged (shapely.ops.linemerge) into a
single MultiLineString and written as 2D little-endian WKB.

Idempotent: UPDATE ... WHERE shape IS NULL (re-running only fills remaining nulls).
CRS: both datasets are NAD83/EPSG:4269 (verified with ogrinfo) -> no reprojection.

No GDAL Python bindings on this host, so the NFS geometry is extracted from the .gdb with
ogr2ogr into a plain-WKB SQLite cache next to the .gdb (rebuilt each run).

Operational guardrails (see README): snapshot navi.db first, stop navi-offroute during
writes, --dry-run to preview.
"""
import argparse
import os
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict

from shapely import wkb, to_wkb
from shapely.geometry import MultiLineString
from shapely.ops import linemerge

DEFAULT_DB = "/mnt/nav/navi.db"
DEFAULT_NFS_GDB = "/mnt/nav/sources/mvum/Trans_Trail_NFS_Publish.gdb"
NFS_LAYER = "Trans_Trail_NFS_Publish"

# Both datasets are EPSG:4269 (NAD83); no transform. If that ever changes, reproject here.
NFS_EPSG = 4269
MVUM_EPSG = 4269


def extract_nfs(nfs_gdb):
    """Extract TRAIL_NO/TRAIL_NAME/ADMIN_ORG + geometry (plain WKB) from the NFS .gdb into
    a SQLite cache next to it, via ogr2ogr. Returns the cache path."""
    if not os.path.exists(nfs_gdb):
        sys.exit(f"NFS GDB not found: {nfs_gdb}")
    cache = os.path.join(os.path.dirname(nfs_gdb), "_nfs_centerline_extract.sqlite")
    if os.path.exists(cache):
        os.remove(cache)
    print(f"Extracting {NFS_LAYER} -> {cache} (ogr2ogr) ...")
    subprocess.run(
        ["ogr2ogr", "-f", "SQLite", cache, nfs_gdb, NFS_LAYER,
         "-dsco", "SPATIALITE=NO", "-nln", "nfs",
         "-select", "TRAIL_NO,TRAIL_NAME,ADMIN_ORG"],
        check=True)
    conn = sqlite3.connect(cache)
    conn.execute("CREATE INDEX IF NOT EXISTS ix_nfs ON nfs(trail_no, trail_name)")
    conn.commit()
    conn.close()
    return cache


def load_nfs(cache):
    """In-memory NFS indices from the plain-WKB SQLite cache.
      by_key[(trail_no, trail_name, prefix4)] -> [wkb bytes]   (non-null geom)
      by_nn[(trail_no, trail_name)]           -> [wkb bytes]   (non-null geom, any forest)
      prefixes[(trail_no, trail_name)]        -> {prefix4}     (non-null geom)
      nullkeys_nn                             -> {(trail_no, trail_name)} (NFS row, NULL geom)
    """
    c = sqlite3.connect(f"file:{cache}?mode=ro", uri=True)
    by_key, by_nn, prefixes = defaultdict(list), defaultdict(list), defaultdict(set)
    nullkeys_nn = set()
    for no, nm, org, shp in c.execute("SELECT trail_no, trail_name, admin_org, shape FROM nfs"):
        if no is None or nm is None or org is None:
            continue
        if shp is None:
            nullkeys_nn.add((no, nm))
            continue
        p4 = org[:4]
        b = bytes(shp)
        by_key[(no, nm, p4)].append(b)
        by_nn[(no, nm)].append(b)
        prefixes[(no, nm)].add(p4)
    c.close()
    return by_key, by_nn, prefixes, nullkeys_nn


def build_forest_prefix_map(con, prefixes):
    """forestname -> {ADMIN_ORG 4-prefix}, learned from non-null mvum_trails rows."""
    fmap = defaultdict(set)
    for r in con.execute("SELECT id, name, forestname FROM mvum_trails WHERE shape IS NOT NULL"):
        if not (r["id"] and r["name"] and r["forestname"]):
            continue
        ps = prefixes.get((r["id"], r["name"]))
        if ps:
            fmap[r["forestname"]] |= ps
    return fmap


def aggregate(blobs):
    """Merge candidate NFS geometries into a single MultiLineString (or None)."""
    lines = []
    for b in blobs:
        g = wkb.loads(b)
        if g.is_empty:
            continue
        if g.geom_type == "LineString":
            lines.append(g)
        elif g.geom_type == "MultiLineString":
            lines.extend(g.geoms)
    if not lines:
        return None
    merged = linemerge(lines) if len(lines) > 1 else lines[0]
    if merged.geom_type == "LineString":
        merged = MultiLineString([merged])
    if merged.geom_type != "MultiLineString" or merged.is_empty:
        return None
    return merged


def main():
    ap = argparse.ArgumentParser(description="Backfill mvum_trails.shape from NFS centerlines.")
    ap.add_argument("--db-path", default=DEFAULT_DB, help="navi.db to backfill (default: %(default)s)")
    ap.add_argument("--nfs-gdb", default=DEFAULT_NFS_GDB, help="NFS centerline .gdb (default: %(default)s)")
    ap.add_argument("--dry-run", action="store_true", help="count what would change; no UPDATEs")
    args = ap.parse_args()

    if MVUM_EPSG != NFS_EPSG:
        sys.exit(f"CRS mismatch ({MVUM_EPSG} vs {NFS_EPSG}) — reprojection not implemented")

    cache = extract_nfs(args.nfs_gdb)
    by_key, by_nn, prefixes, nullkeys_nn = load_nfs(cache)

    con = sqlite3.connect(args.db_path)
    con.row_factory = sqlite3.Row
    fmap = build_forest_prefix_map(con, prefixes)
    nulls = con.execute(
        "SELECT ogc_fid, id, name, forestname FROM mvum_trails WHERE shape IS NULL"
    ).fetchall()

    def lookup(r):
        if not (r["id"] and r["name"]):
            return []
        ps = fmap.get(r["forestname"])
        if ps:
            blobs = []
            for p in ps:
                blobs.extend(by_key.get((r["id"], r["name"], p), []))
            if blobs:
                return blobs
        # fallback: name+number only (unmapped forest, or mapped but no in-prefix match)
        return by_nn.get((r["id"], r["name"]), [])

    cnt = Counter()
    cur = con.cursor()
    for r in nulls:
        cnt["rows_attempted"] += 1
        blobs = lookup(r)
        if not blobs:
            if r["id"] and r["name"] and (r["id"], r["name"]) in nullkeys_nn:
                cnt["rows_skipped_nfs_null_geom"] += 1
            else:
                cnt["rows_skipped_no_match"] += 1
            continue
        geom = aggregate(blobs)
        if geom is None:
            cnt["rows_skipped_bad_geom"] += 1
            continue
        if args.dry_run:
            cnt["rows_updated"] += 1  # would update
            continue
        out = to_wkb(geom, output_dimension=2, byte_order=1)
        cur.execute("UPDATE mvum_trails SET shape=? WHERE ogc_fid=? AND shape IS NULL",
                    (out, r["ogc_fid"]))
        cnt["rows_updated"] += cur.rowcount
    if not args.dry_run:
        con.commit()
    con.close()

    print("=== backfill counters%s ===" % (" (DRY RUN — no writes)" if args.dry_run else ""))
    for k in ["rows_attempted", "rows_updated", "rows_skipped_no_match",
              "rows_skipped_nfs_null_geom", "rows_skipped_bad_geom"]:
        print(f"  {k}: {cnt[k]}")


if __name__ == "__main__":
    main()
