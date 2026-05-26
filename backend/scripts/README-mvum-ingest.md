# MVUM ingest pipeline

How the `mvum_roads` / `mvum_trails` tables in `navi.db` are **produced** from USFS data.
The navi-offroute service code only **consumes** these tables — see
`backend/services/navi_offroute/mvum.py` (access logic + `MVUMSpatialIndex`),
`mvum_annotate.py` (Layer 1 per-edge annotation), and `mvum_exclude.py` (Layer 2c
`exclude_polygons`). The scripts here are the producers.

## Source datasets (USFS EDW)

Published as File Geodatabases (national rollups):

- Roads: <https://data.fs.usda.gov/geodata/edw/edw_resources/fc/Trans_MVUM_Road.gdb.zip>
- Trails (MVUM legal access): <https://data.fs.usda.gov/geodata/edw/edw_resources/fc/Trans_MVUM_Trail.gdb.zip>
- Trail centerlines (geometry donor for the backfill): <https://data.fs.usda.gov/geodata/edw/edw_resources/fc/Trans_Trail_NFS_Publish.gdb.zip>

Keep the unzipped `.gdb`s under `/mnt/nav/sources/mvum/`. Both MVUM and NFS data are
NAD83 / EPSG:4269, and `ogr2ogr` is loaded with `SPATIALITE=NO` so geometry is stored as
plain WKB blobs that shapely and `MVUMSpatialIndex` read directly.

> **Always, before any write to `navi.db`:** snapshot to a named, dated, persistent file
> (never `/tmp`) and stop the service:
> ```
> sudo systemctl stop navi-offroute
> sqlite3 /mnt/nav/navi.db ".backup /mnt/nav/navi-pre-<change>-<YYYY-MM-DD>.db"
> #   ... run the ingest/backfill ...
> sudo systemctl start navi-offroute
> ```
> Rollback = restore the snapshot over `navi.db` and restart.

## 1. Initial ingest (one-time, building navi.db from scratch)

Load each MVUM GDB layer into its table. `ogr2ogr` shape (run from `/mnt/nav/sources/mvum/`):

```
# roads -> mvum_roads
ogr2ogr -f SQLite /mnt/nav/navi.db Trans_MVUM_Road.gdb  Trans_MVUM_Road \
        -dsco SPATIALITE=NO -nln mvum_roads  -update -overwrite

# trails -> mvum_trails
ogr2ogr -f SQLite /mnt/nav/navi.db Trans_MVUM_Trail.gdb Trans_MVUM_Trail \
        -dsco SPATIALITE=NO -nln mvum_trails -update -overwrite
```

`-update` appends to the existing `navi.db` (it holds other navi tables); `-overwrite`
replaces just the named table. This yields `ogc_fid`, a `shape` WKB blob, and the MVUM
attribute columns (`id`, `name`, `forestname`, `symbol`, `atv`, `highclearancevehicle`,
`e_bike_class1`, the `*_datesopen` fields, etc.). Then run the trail backfill (step 3) to
fill the geometry-sparse trail rows.

## 2. Refresh (USFS published new MVUM data)

```
cd /mnt/nav/sources/mvum
for f in Trans_MVUM_Road Trans_MVUM_Trail Trans_Trail_NFS_Publish; do
  curl -L --fail -o "$f.gdb.zip" \
    "https://data.fs.usda.gov/geodata/edw/edw_resources/fc/$f.gdb.zip"
  rm -rf "$f.gdb" && unzip -o "$f.gdb.zip"
done
# (snapshot + stop service as above)
ogr2ogr -f SQLite /mnt/nav/navi.db Trans_MVUM_Road.gdb  Trans_MVUM_Road  -dsco SPATIALITE=NO -nln mvum_roads  -update -overwrite
ogr2ogr -f SQLite /mnt/nav/navi.db Trans_MVUM_Trail.gdb Trans_MVUM_Trail -dsco SPATIALITE=NO -nln mvum_trails -update -overwrite
python backend/scripts/mvum_backfill.py --db-path /mnt/nav/navi.db   # then restart service
```

## 3. Repair (mvum_trails has NULL shapes — the gap fixed in P1–P3)

When only the trail geometry is missing (no full re-ingest needed), just run the NFS
backfill. Preview first, then apply:

```
# preview (no writes)
python backend/scripts/mvum_backfill.py --db-path /mnt/nav/navi.db --dry-run

# apply (after snapshot + stopping the service)
python backend/scripts/mvum_backfill.py --db-path /mnt/nav/navi.db
```

`mvum_backfill.py` extracts the NFS centerlines from `--nfs-gdb` (default
`/mnt/nav/sources/mvum/Trans_Trail_NFS_Publish.gdb`) into a `_nfs_centerline_extract.sqlite`
cache beside the `.gdb`, matches each null `mvum_trails` row by `TRAIL_NO`+`TRAIL_NAME`
within the forest's `ADMIN_ORG` prefix, merges the matched segments, and writes WKB.
It is idempotent (`UPDATE ... WHERE shape IS NULL`) and prints counters
(`rows_attempted`, `rows_updated`, `rows_skipped_no_match`, `rows_skipped_nfs_null_geom`).
Typical full-population recovery is ~97%; the residual is rows with no join key or trails
absent from NFS / null in NFS too.

After any write: `sudo systemctl start navi-offroute` (each worker rebuilds
`MVUMSpatialIndex` at boot, ~8 s).
