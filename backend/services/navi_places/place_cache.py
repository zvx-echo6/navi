"""SQLite place cache for navi-places (port of recon's place_detail cache layer).

Owns the shared connection to NAVI_PLACE_CACHE_DB (default
/var/lib/navi-backend/place_cache.db) and AUTO-CREATES the schema on first open:
  - `place_cache` (incl. the google_place_id/google_data/google_fetched_at
    columns recon added by migration — created here so a fresh DB works for both
    the base cache and the google_places cache)
  - `google_api_calls` (the Google daily-cap counter)
WAL, check_same_thread=False, lazy module-level conn. reset_cache() lets
create_app() refresh per worker / tests point at a tmp DB.
"""
import json
import os
import time

DEFAULT_DB_PATH = '/var/lib/navi-backend/place_cache.db'

# Cache entries older than this are treated as a miss so enrichment changes (new
# wiki rewrites, etc.) propagate without a manual truncate. Override with the
# NAVI_PLACE_CACHE_TTL_DAYS env var (days; default 30).
DEFAULT_TTL_DAYS = 30

_db_conn = None


def _ttl_seconds():
    """Cache entry lifetime in seconds (NAVI_PLACE_CACHE_TTL_DAYS, default 30 days)."""
    raw = os.environ.get('NAVI_PLACE_CACHE_TTL_DAYS')
    if raw is None:
        return DEFAULT_TTL_DAYS * 86400
    try:
        return float(raw) * 86400
    except ValueError:
        return DEFAULT_TTL_DAYS * 86400


def db_path():
    return os.environ.get('NAVI_PLACE_CACHE_DB', DEFAULT_DB_PATH)


def get_conn():
    """Return the module-level SQLite connection (lazy init + auto-create schema)."""
    global _db_conn
    if _db_conn is not None:
        return _db_conn

    import sqlite3
    path = db_path()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    _db_conn = sqlite3.connect(path, check_same_thread=False)
    _db_conn.execute("PRAGMA journal_mode=WAL")
    _db_conn.execute("PRAGMA synchronous=NORMAL")
    # Full place_cache schema incl. the google_* columns (recon added these by
    # migration; we create them up front so a fresh auto-created DB serves both
    # cache_put and cache_put_google).
    _db_conn.execute("""
        CREATE TABLE IF NOT EXISTS place_cache (
            osm_type TEXT NOT NULL,
            osm_id INTEGER NOT NULL,
            data TEXT NOT NULL,
            source TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            google_place_id TEXT,
            google_data TEXT,
            google_fetched_at INTEGER,
            PRIMARY KEY (osm_type, osm_id)
        )
    """)
    _db_conn.execute("""
        CREATE TABLE IF NOT EXISTS google_api_calls (
            call_date TEXT PRIMARY KEY,
            call_count INTEGER NOT NULL DEFAULT 0
        )
    """)
    # Idempotent TTL-column guard for any legacy DB predating cached_at (the CREATE
    # above always includes it, so this only fires on an older on-disk DB). Existing
    # rows get cached_at=0 -> treated as expired -> refreshed on next access.
    cols = {r[1] for r in _db_conn.execute("PRAGMA table_info(place_cache)")}
    if 'cached_at' not in cols:
        _db_conn.execute("ALTER TABLE place_cache ADD COLUMN cached_at INTEGER DEFAULT 0")
    _db_conn.commit()
    return _db_conn


def reset_cache():
    """Close + drop the cached connection so the next access reopens fresh."""
    global _db_conn
    if _db_conn is not None:
        try:
            _db_conn.close()
        except Exception:
            pass
    _db_conn = None


def cache_get(osm_type, osm_id):
    """Return a cached place dict, or None on miss / TTL expiry.

    A hit older than the TTL (NAVI_PLACE_CACHE_TTL_DAYS, default 30 days) is treated
    as a miss so the caller refetches + re-enriches; the row is left in place and the
    rewrite (cache_put) overwrites it. Entries with an unknown age (cached_at 0/NULL,
    e.g. legacy rows) are likewise treated as expired.
    """
    db = get_conn()
    row = db.execute(
        "SELECT data, cached_at FROM place_cache WHERE osm_type=? AND osm_id=?",
        (osm_type, osm_id)
    ).fetchone()
    if not row or not row[0]:
        return None
    cached_at = row[1]
    if not cached_at or (time.time() - cached_at) > _ttl_seconds():
        return None
    try:
        result = json.loads(row[0])
        result['source'] = 'cache'
        return result
    except (json.JSONDecodeError, TypeError):
        return None


def cache_put(osm_type, osm_id, data, source):
    """Store a place detail result in the cache (preserves google columns)."""
    db = get_conn()
    now = int(time.time())
    db.execute("""
        INSERT INTO place_cache (osm_type, osm_id, data, source, cached_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(osm_type, osm_id) DO UPDATE SET
            data = excluded.data,
            source = excluded.source,
            cached_at = excluded.cached_at
    """, (osm_type, osm_id, json.dumps(data), source, now))
    db.commit()
