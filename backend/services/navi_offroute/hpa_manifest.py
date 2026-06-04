"""HPA tile-DB manifest pattern (H6a-pre). Replaces the single-file
``NAVI_OFFROUTE_HPA_DB`` env var with a directory-based manifest
(``NAVI_OFFROUTE_HPA_DIR``) so one deployment can carry multiple regional tile
DBs and look up which one(s) cover a route bbox. The two-level HPA* kernel
(``astar_hpa_multimode``) is unchanged; ``router.py`` asks this module for
matching tile DBs and forwards the path. Schema is encoded in the loaders
below; backward-compat: legacy ``HPA_DB`` alone -> single unbounded entry,
neither env var set -> HPA disabled (same as today).
"""
import json
import logging
import os
import sqlite3
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

MANIFEST_VERSION = 1
ENV_DIR = "NAVI_OFFROUTE_HPA_DIR"
ENV_LEGACY = "NAVI_OFFROUTE_HPA_DB"


@dataclass(frozen=True)
class ChunkBounds:
    """Inclusive chunk-index rectangle."""
    min_x: int
    max_x: int
    min_y: int
    max_y: int

    def intersects(self, cx_min: int, cx_max: int, cy_min: int, cy_max: int) -> bool:
        return not (cx_max < self.min_x or cx_min > self.max_x
                    or cy_max < self.min_y or cy_min > self.max_y)


@dataclass(frozen=True)
class TileDBEntry:
    name: str
    abs_path: str
    chunk_bounds: Optional[ChunkBounds]   # None -> unbounded


@dataclass
class HPAManifest:
    """Registry of regional tile DBs + lazy per-path sqlite connection cache.
    The cache is process-local mutable state; entries are immutable after load."""
    entries: List[TileDBEntry] = field(default_factory=list)
    _conns: Dict[str, sqlite3.Connection] = field(default_factory=dict)

    def enabled(self) -> bool:
        return len(self.entries) > 0

    def dbs_for_chunks(self, cx_min: int, cx_max: int,
                       cy_min: int, cy_max: int) -> List[str]:
        """Tile DBs whose chunk_bounds intersect the chunk rectangle. Unbounded
        entries always match. Preserves declaration order."""
        out = []
        for e in self.entries:
            if e.chunk_bounds is None or e.chunk_bounds.intersects(
                    cx_min, cx_max, cy_min, cy_max):
                out.append(e.abs_path)
        return out

    def dbs_for_route_bbox(self, south: float, north: float,
                           west: float, east: float) -> List[str]:
        """Resolve a route's degree bbox to its chunk-index rectangle and look up
        matching DB paths. Local import keeps this module independent of the
        build pipeline's import graph."""
        from .hpa_build import chunk_coords
        cx0, cy0 = chunk_coords(south, west)
        cx1, cy1 = chunk_coords(north, east)
        return self.dbs_for_chunks(min(cx0, cx1), max(cx0, cx1),
                                   min(cy0, cy1), max(cy0, cy1))

    def get_connection(self, abs_path: str) -> sqlite3.Connection:
        """Read-only sqlite connection cached for the life of the process. v1
        dispatch (astar_hpa_multimode) opens its own connection per call and does
        not yet use this cache; multi-region UNION + admin endpoints will."""
        conn = self._conns.get(abs_path)
        if conn is None:
            conn = sqlite3.connect(f"file:{abs_path}?mode=ro", uri=True)
            self._conns[abs_path] = conn
        return conn


# ── loaders ──────────────────────────────────────────────────────────────────

def _load_from_dir(dir_path: str) -> HPAManifest:
    """Parse ``<dir>/manifest.json``. Fails fast on bad version, missing file,
    or any entry whose resolved path is absent."""
    mpath = os.path.join(dir_path, "manifest.json")
    if not os.path.isfile(mpath):
        raise FileNotFoundError(f"HPA manifest not found at {mpath}")
    with open(mpath) as f:
        data = json.load(f)
    if data.get("version") != MANIFEST_VERSION:
        raise ValueError(
            f"HPA manifest at {mpath}: unsupported version "
            f"{data.get('version')!r} (expected {MANIFEST_VERSION})")
    entries: List[TileDBEntry] = []
    for raw in data.get("tile_dbs") or []:
        name = raw["name"]
        rel = raw["path"]
        abs_path = rel if os.path.isabs(rel) else os.path.join(dir_path, rel)
        if not os.path.isfile(abs_path):
            raise FileNotFoundError(
                f"HPA manifest at {mpath}: entry {name!r} -> {abs_path} not found")
        cb_raw = raw.get("chunk_bounds")
        cb = (ChunkBounds(min_x=int(cb_raw["min_x"]), max_x=int(cb_raw["max_x"]),
                          min_y=int(cb_raw["min_y"]), max_y=int(cb_raw["max_y"]))
              if cb_raw is not None else None)
        entries.append(TileDBEntry(name=name, abs_path=abs_path, chunk_bounds=cb))
    return HPAManifest(entries=entries)


def _load_from_legacy(legacy_path: str) -> HPAManifest:
    """Synthesize a single unbounded entry from ``NAVI_OFFROUTE_HPA_DB``. Always
    warns; missing file -> empty (HPA disabled, same as today)."""
    if not os.path.isfile(legacy_path):
        logger.warning("%s=%s does not exist; HPA disabled", ENV_LEGACY, legacy_path)
        return HPAManifest(entries=[])
    logger.warning(
        "%s is deprecated; migrate to %s + manifest.json. "
        "Treating %s as an unbounded single-entry manifest.",
        ENV_LEGACY, ENV_DIR, legacy_path)
    return HPAManifest(entries=[TileDBEntry(
        name="legacy", abs_path=legacy_path, chunk_bounds=None)])


def load() -> HPAManifest:
    """Load the active manifest from env. ``HPA_DIR`` wins over ``HPA_DB`` if
    both are set (warns); neither -> empty (HPA disabled)."""
    dir_env = os.environ.get(ENV_DIR)
    legacy_env = os.environ.get(ENV_LEGACY)
    if dir_env:
        if legacy_env:
            logger.warning(
                "Both %s and %s are set; %s takes precedence",
                ENV_DIR, ENV_LEGACY, ENV_DIR)
        return _load_from_dir(dir_env)
    if legacy_env:
        return _load_from_legacy(legacy_env)
    return HPAManifest(entries=[])
