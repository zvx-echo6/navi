# OSM parking ingest

How `/mnt/nav/osm-parking.db` is **produced** from OSM data. navi-offroute's Layer 3b
(`backend/services/navi_offroute/mvum_parking.py`, `OSMParkingIndex`) **consumes** it
read-only as multi-modal Auto transition candidates (drive → parking → foot/2w/4w).
This is the producer; nothing here touches `navi.db`.

## Source

geofabrik regional extract (North America used in production):
<https://download.geofabrik.de/north-america-latest.osm.pbf> (+ the `.md5`).

Keep downloads/intermediates under `/mnt/nav/sources/osm/`. The final DB lives at
`/mnt/nav/osm-parking.db` (separate from `navi.db`).

> Tools: `osmium` (osmium-tool, CLI) and the repo venv's Python (`shapely` — no
> pyosmium/GDAL needed). No service writes here; the index loads the DB read-only.

## Refresh recipe

```bash
cd /mnt/nav/sources/osm

# 1. download + verify
curl -L --fail -o north-america-latest.osm.pbf.md5 \
  https://download.geofabrik.de/north-america-latest.osm.pbf.md5
curl -L --fail -C - -o north-america-latest.osm.pbf \
  https://download.geofabrik.de/north-america-latest.osm.pbf
exp=$(awk '{print $1}' north-america-latest.osm.pbf.md5)
act=$(md5sum north-america-latest.osm.pbf | awk '{print $1}')
[ "$exp" = "$act" ] && echo "MD5 OK" || { echo "MD5 MISMATCH"; exit 1; }

# 2. filter to amenity=parking (nwr = nodes+ways+relations; referenced nodes kept
#    by default so way/relation polygons stay buildable)
osmium tags-filter north-america-latest.osm.pbf nwr/amenity=parking \
  -o north-america-parking.osm.pbf --overwrite

# 3. export to GeoJSONSeq with osm type+id attributes
osmium export north-america-parking.osm.pbf -f geojsonseq -a type,id \
  -o north-america-parking.geojsonseq --overwrite

# 4. ingest -> osm-parking.db  (repo venv python; ~3 min for NA)
/home/zvx/projects/repos/navi-mono/backend/.venv/bin/python \
  /home/zvx/projects/repos/navi-mono/backend/scripts/ingest_parking.py \
  --geojsonseq north-america-parking.geojsonseq --db /mnt/nav/osm-parking.db

# 5. (optional) reclaim space after the dedupe re-write
sqlite3 /mnt/nav/osm-parking.db "VACUUM;"

# 6. pick up the new data: each navi-offroute worker rebuilds OSMParkingIndex at boot
sudo systemctl restart navi-offroute
```

## Schema

`parking(id INTEGER PK, osm_id TEXT, osm_type TEXT, name TEXT, capacity INTEGER NULL,
access TEXT NULL, parking_type TEXT NULL, lat REAL, lon REAL, shape BLOB)` + index
`idx_parking_latlon(lat, lon)`. Geometry: WKB Point for nodes, (Multi)Polygon for
areas; `lat`/`lon` hold an interior `representative_point()` (the index builds its
STRtree from these directly, skipping per-row WKB parsing at boot).

## Notes

- `osmium export` emits each closed area-way **twice** (raw LineString + assembled
  polygon); the ingest drops Line geometries to keep one geometry per object. Rare
  genuinely-open parking ways (data errors) are dropped with them.
- `OSMParkingIndex` further drops `access` in (`private`, `no`, `permit`) at load —
  off-limits lots are useless as transition candidates.
- North America ≈ 1.67M parking objects after dedupe (~500 MB DB). Verify:
  `sqlite3 /mnt/nav/osm-parking.db "SELECT COUNT(*), osm_type FROM parking GROUP BY osm_type;"`
