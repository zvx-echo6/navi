"""HPA* offline precompute pipeline (spec HPA-SPEC.md §7, Phase H2).

Standalone CLI: for every chunk a region's bbox covers, run small entrance-to-entrance A*
searches on the chunk's native-resolution cost grid and store the scalar costs into a
per-region SQLite (spec §6). No router/kernel wiring — H3 consumes these tiles.

    python -m services.navi_offroute.hpa_build \
        --region idaho --bbox 41.9,-117.3,49.1,-110.9 --output /mnt/nav/hpa/idaho.db

Deliberate v1 scope / deviations (flag for spec amendment):
- BOTH directions stored, not `from < to`. The anisotropic slope model (signed Tobler /
  Herzog / linear) makes uphill cost != downhill, so entrance-pair costs are NOT symmetric:
  20×19 = 380 ordered pairs per mode per chunk, not the 190 spec §4 implies. Recommend
  amending §4/§6 to say "directed pairs".
- Costs are PURE TERRAIN (slope + WorldCover friction + trails + wilderness). Boundary-mode
  rules (PAD-US barriers, MVUM closures) and network_affinity are NOT baked — they are
  boundary-mode/request dependent and belong at query time / in the fallback (H3). The build
  passes a zero barrier grid; wilderness impassability (mode-fixed, not boundary-dependent)
  IS baked.
- Only the 20 border entrances (spec §4). Transition cells (entrances ≥20, spec §5) are NOT
  built here: they need the TrailheadIndex/OSMParkingIndex runtime singletons, deferred to
  H3 / a follow-up. Known v1 limitation.
- Chunk grid: fixed-degree plate-carrée pinned at lat=0/lon=0, step CHUNK_DEG = 1.5 km / 111
  (spec §3/§13). No cos(lat) correction — a per-cell cos would make chunk boundaries
  latitude-dependent and break the deterministic global grid. Chunks are thus ~1.5 km tall
  and (cos lat)·1.5 km wide; entrance cells scale to each chunk's actual fetched grid shape,
  so the nominal "50×50" is not assumed. The §3 Z12-tile 5×5 alignment (an I/O optimization)
  is deferred: v1 reads per chunk.
"""
import argparse
import hashlib
import math
import os
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

import numpy as np

from shared.dem import DEMReader, dem_path
from .astar import astar_multigoal, inflate_cost_multiplier
from .barriers import WildernessReader, wilderness_tif_path
from .cost import MODE_PROFILES, compute_cost_multiplier_grid
from .friction import FrictionReader, friction_to_multiplier
from .trails import TrailReader

MODE_ORDER = ["foot", "2w", "4w", "vehicle"]
_SPEED_FN_ID = {"tobler": 0, "herzog": 1, "linear": 2}

# Deterministic chunk grid (spec §3/§13): plate-carrée, pinned at lat=0/lon=0.
CHUNK_KM = 1.5
KM_PER_DEG = 111.0
CHUNK_DEG = CHUNK_KM / KM_PER_DEG                 # ~0.013514 deg per chunk, both axes
ENTRANCES_PER_EDGE = 5
EDGE_FRACTIONS = (1.0 / 6, 2.0 / 6, 3.0 / 6, 4.0 / 6, 5.0 / 6)  # spec §4

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chunk_costs (
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  mode_idx INTEGER NOT NULL,
  from_entrance INTEGER NOT NULL,
  to_entrance INTEGER NOT NULL,
  cost_s REAL NOT NULL,
  PRIMARY KEY (chunk_x, chunk_y, mode_idx, from_entrance, to_entrance)
);
CREATE INDEX IF NOT EXISTS idx_chunk_mode ON chunk_costs (chunk_x, chunk_y, mode_idx);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""
_INSERT = ("INSERT OR REPLACE INTO chunk_costs "
           "(chunk_x, chunk_y, mode_idx, from_entrance, to_entrance, cost_s) VALUES (?,?,?,?,?,?)")


# ── deterministic chunk geometry ─────────────────────────────────────────────

def chunk_coords(lat, lon):
    """(chunk_x, chunk_y) for a lat/lon on the global plate-carrée grid pinned at 0/0."""
    return int(math.floor(lon / CHUNK_DEG)), int(math.floor(lat / CHUNK_DEG))


def chunk_bounds(chunk_x, chunk_y):
    """(south, west, north, east) degrees for a chunk."""
    return (chunk_y * CHUNK_DEG, chunk_x * CHUNK_DEG,
            (chunk_y + 1) * CHUNK_DEG, (chunk_x + 1) * CHUNK_DEG)


def chunks_in_bbox(south, west, north, east):
    """All (chunk_x, chunk_y) whose cells the bbox touches (inclusive)."""
    cx0, cy0 = chunk_coords(south, west)
    cx1, cy1 = chunk_coords(north, east)
    return [(cx, cy)
            for cx in range(min(cx0, cx1), max(cx0, cx1) + 1)
            for cy in range(min(cy0, cy1), max(cy0, cy1) + 1)]


def _entrance_cells(rows, cols):
    """The 20 border entrance (row, col) cells, indexed per spec §4:
    0..4 top L→R, 5..9 right T→B, 10..14 bottom L→R, 15..19 left T→B."""
    r_last, c_last = rows - 1, cols - 1
    cells = []
    cells += [(0, int(round(f * c_last))) for f in EDGE_FRACTIONS]            # top
    cells += [(int(round(f * r_last)), c_last) for f in EDGE_FRACTIONS]       # right
    cells += [(r_last, int(round(f * c_last))) for f in EDGE_FRACTIONS]       # bottom
    cells += [(int(round(f * r_last)), 0) for f in EDGE_FRACTIONS]            # left
    return cells


# ── per-chunk cost computation (pure: testable without readers/processes) ─────

def compute_chunk_rows(chunk_x, chunk_y, elevation, friction_mult, friction_raw,
                       trails, wilderness, cell_size_m, modes=MODE_ORDER):
    """Entrance-to-entrance directed costs for one chunk. Returns a list of
    (chunk_x, chunk_y, mode_idx, from_entrance, to_entrance, cost_s) rows (finite only)."""
    rows, cols = elevation.shape
    if rows < 2 or cols < 2:
        return []
    entrances = _entrance_cells(rows, cols)
    elev = np.ascontiguousarray(elevation, dtype=np.float64)
    barrier_grid = np.zeros((rows, cols), dtype=np.uint8)        # barriers not baked (see docstring)
    trail_grid = np.ascontiguousarray(
        trails if trails is not None else np.zeros((rows, cols), np.uint8), dtype=np.uint8)
    cs = float(cell_size_m)
    out = []
    for mi, mode in enumerate(modes):
        prof = MODE_PROFILES[mode]
        cm = compute_cost_multiplier_grid(
            elevation, cell_size_lat_m=cs, cell_size_lon_m=cs,
            friction=friction_mult, friction_raw=friction_raw, wilderness=wilderness, mode=mode)
        cm = np.ascontiguousarray(inflate_cost_multiplier(cm), dtype=np.float64)
        tfl = np.full(256, np.inf, dtype=np.float64)
        for tv, fric in prof.trail_friction.items():
            tfl[tv] = np.inf if fric is None else float(fric)
        sfid = _SPEED_FN_ID.get(prof.speed_function, 0)
        mg = float(np.tan(np.radians(prof.max_slope_deg)))
        bspd = float(prof.base_speed_kmh)
        for fi, (fr, fc) in enumerate(entrances):
            for ti, (gr, gc) in enumerate(entrances):
                if ti == fi:
                    continue
                _, _, cost = astar_multigoal(
                    cm, elev, cs, cs, mg, sfid, bspd, trail_grid, tfl, barrier_grid, 1,
                    int(fr), int(fc),
                    np.array([gr], dtype=np.int64), np.array([gc], dtype=np.int64))
                if np.isfinite(cost):
                    out.append((chunk_x, chunk_y, mi, fi, ti, float(cost)))
    return out


# ── reader-backed chunk fetch + process worker ───────────────────────────────

_READERS = {}


def _get_readers():
    """Lazily build the readers once per (worker) process."""
    if not _READERS:
        _READERS["dem"] = DEMReader(dem_path())
        _READERS["friction"] = FrictionReader()
        _READERS["trail"] = TrailReader()
        _READERS["wild"] = WildernessReader() if wilderness_tif_path().exists() else None
    return _READERS


def _fetch_chunk_rasters(chunk_x, chunk_y, readers):
    """Fetch (elevation, friction_mult, friction_raw, trails, wilderness, cell_size_m) for a
    chunk via the existing readers — same pattern as router._fetch_auto_rasters."""
    s, w, n, e = chunk_bounds(chunk_x, chunk_y)
    elevation, meta = readers["dem"].get_elevation_grid(south=s, north=n, west=w, east=e)
    shape = elevation.shape
    friction_raw = readers["friction"].get_friction_grid(
        south=s, north=n, west=w, east=e, target_shape=shape)
    friction_mult = friction_to_multiplier(friction_raw)
    trails = readers["trail"].get_trails_grid(south=s, north=n, west=w, east=e, target_shape=shape)
    wilderness = None
    if readers["wild"] is not None:
        wilderness = readers["wild"].get_wilderness_grid(
            south=s, north=n, west=w, east=e, target_shape=shape)
    return elevation, friction_mult, friction_raw, trails, wilderness, float(meta["cell_size_m"])


def _chunk_worker(chunk):
    """ProcessPool worker: fetch + compute one chunk's rows. Errors -> empty (logged by caller)."""
    cx, cy = chunk
    try:
        readers = _get_readers()
        elev, fmult, fraw, trails, wild, cs = _fetch_chunk_rasters(cx, cy, readers)
        return cx, cy, compute_chunk_rows(cx, cy, elev, fmult, fraw, trails, wild, cs), None
    except Exception as exc:  # pragma: no cover - exercised in H4 ops, not unit tests
        return cx, cy, [], repr(exc)


# ── SQLite assembly ──────────────────────────────────────────────────────────

def _init_schema(conn):
    conn.executescript(_SCHEMA)


def _mode_profile_hash():
    return hashlib.sha256(repr(MODE_PROFILES).encode()).hexdigest()


def _dem_version():
    try:
        return f"mtime:{int(os.path.getmtime(dem_path()))}"
    except Exception:
        return "unknown"


def _git_commit():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return "unknown"


def _write_meta(conn, region, bbox):
    meta = {
        "region_name": region,
        "region_bbox": ",".join(str(x) for x in bbox),
        "chunk_size_cells": "50",
        "chunk_size_km": str(CHUNK_KM),
        "chunk_deg": repr(CHUNK_DEG),
        "entrances_per_edge": str(ENTRANCES_PER_EDGE),
        "mode_profile_hash": _mode_profile_hash(),
        "dem_version": _dem_version(),
        "build_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "build_git_commit": _git_commit(),
    }
    conn.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", list(meta.items()))


def build_region(region, bbox, output, max_workers=None, chunks_only=None):
    """Build the cost-tile SQLite for `bbox`=(south, west, north, east). Returns a summary dict."""
    south, west, north, east = bbox
    chunks = chunks_in_bbox(south, west, north, east)
    if chunks_only is not None:
        x0, y0, x1, y1 = chunks_only
        chunks = [(cx, cy) for (cx, cy) in chunks
                  if min(x0, x1) <= cx <= max(x0, x1) and min(y0, y1) <= cy <= max(y0, y1)]

    conn = sqlite3.connect(output)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    _init_schema(conn)
    _write_meta(conn, region, bbox)
    conn.commit()

    t0 = time.perf_counter()
    rows_total, failed = 0, []
    workers = max_workers or os.cpu_count()
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for cx, cy, chunk_rows, err in ex.map(_chunk_worker, chunks):
            if err is not None:
                failed.append((cx, cy, err))
                continue
            if chunk_rows:
                conn.executemany(_INSERT, chunk_rows)
                rows_total += len(chunk_rows)
    conn.commit()
    elapsed = time.perf_counter() - t0
    # Stored rows are finite only; the rest of the 380×modes×chunks possibilities were pruned.
    possible = len(chunks) * len(MODE_ORDER) * 20 * 19
    summary = {"region": region, "chunks": len(chunks), "rows": rows_total,
               "inf_pruned": possible - rows_total, "failed": len(failed),
               "workers": workers, "elapsed_s": elapsed}
    conn.execute("VACUUM")
    conn.close()
    print(f"HPA build [{region}]: {summary['chunks']} chunks, {rows_total} rows, "
          f"{summary['inf_pruned']} inf-pruned, {len(failed)} failed, "
          f"{workers} workers, {elapsed:.1f}s -> {output}")
    for cx, cy, err in failed[:10]:
        print(f"  chunk ({cx},{cy}) failed: {err}", file=sys.stderr)
    return summary


def _parse_csv_floats(s, n):
    parts = [float(x) for x in s.split(",")]
    if len(parts) != n:
        raise argparse.ArgumentTypeError(f"expected {n} comma-separated values, got {len(parts)}")
    return parts


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="python -m services.navi_offroute.hpa_build",
        description="Precompute HPA* chunk-cost tiles for a region (HPA-SPEC.md §7).")
    p.add_argument("--region", required=True, help="region name, recorded in meta.region_name")
    p.add_argument("--bbox", required=True, type=lambda s: _parse_csv_floats(s, 4),
                   metavar="S,W,N,E", help="region bbox: south,west,north,east (decimal degrees)")
    p.add_argument("--output", required=True, help="path to the SQLite tile DB to create")
    p.add_argument("--max-workers", type=int, default=os.cpu_count(),
                   help="ProcessPoolExecutor workers (default: os.cpu_count())")
    p.add_argument("--chunks-only", type=lambda s: [int(x) for x in s.split(",")],
                   default=None, metavar="X1,Y1,X2,Y2",
                   help="debug: constrain the build to a chunk-coord bbox")
    args = p.parse_args(argv)
    south, west, north, east = args.bbox
    build_region(args.region, (south, west, north, east), args.output,
                 max_workers=args.max_workers, chunks_only=args.chunks_only)


if __name__ == "__main__":
    main()
