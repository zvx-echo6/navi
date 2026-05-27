"""
OFFROUTE Router — Bidirectional wilderness-to-network path orchestration.

Supports four routing scenarios:
  A: off-network start → on-network end (wilderness then Valhalla)
  B: off-network start → off-network end (wilderness, Valhalla, wilderness)
  C: on-network start → off-network end (Valhalla then wilderness)
  D: on-network start → on-network end (pure Valhalla passthrough)

Off-network detection: Valhalla /locate snap distance > 500m = off-network.

IMPORTANT: The wilderness segment ALWAYS uses foot mode for pathfinding.
The user's selected mode affects:
  1. Which entry points are valid (foot=any, 2w=tracks+roads, vehicle=roads only)
  2. The Valhalla costing profile for the network segment
"""
import gc
import json
import logging
from datetime import datetime
import math
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Literal, Set

import numpy as np
import psutil
import requests
import psycopg2
import psycopg2.extras
from shapely.geometry import LineString, Point
from .astar import astar_multigoal, astar_multigoal_multimode, inflate_cost_multiplier
from .mvum_surface_change import get_surface_change_candidates
from .mvum_parking import load_parking_index  # noqa: F401 (singleton injected by handler)

from shared.dem import DEMReader, dem_path
from .cost import (compute_cost_grid, compute_cost_multiplier_grid, MODE_PROFILES,
                   compute_unified_cost_layers)
from .transitions import MODE_INDEX
from .friction import FrictionReader, friction_to_multiplier
from .barriers import BarrierReader, WildernessReader, wilderness_tif_path
from .trails import TrailReader
from .mvum import get_mvum_access_grid
from .mvum_annotate import annotate_network_edges
from .mvum_exclude import build_exclude_polygons

logger = logging.getLogger("navi_offroute.router")

# Configuration via env vars (extraction #8: was profile.offroute.* in recon;
# promoted to dedicated env vars here — no deployment_config machinery). Read at
# import; the systemd unit's EnvironmentFile supplies them in prod.
OSM_PBF_PATH = Path(os.environ.get("NAVI_OFFROUTE_OSM_PBF", "/mnt/nav/sources/idaho-latest.osm.pbf"))
DENSIFY_INTERVAL_M = int(os.environ.get("NAVI_OFFROUTE_DENSIFY_M", "100"))
POSTGIS_DSN = os.environ.get("NAVI_OFFROUTE_POSTGIS_DSN", "dbname=padus")

# Valhalla endpoint (recon-side network router, HTTP)
VALHALLA_URL = os.environ.get("NAVI_OFFROUTE_VALHALLA_URL", "http://localhost:8002")

# Search radius for entry points (km)
DEFAULT_SEARCH_RADIUS_KM = 50
EXPANDED_SEARCH_RADIUS_KM = 100

# Memory limit
MEMORY_LIMIT_GB = 12

# Off-network detection threshold (meters)
OFF_NETWORK_THRESHOLD_M = 10

# Auto-mode spatial-eligibility snap thresholds (meters).
AUTO_SNAP_TIGHT_M = 5      # on the edge -> eligible without a flatness check
AUTO_SNAP_RELAXED_M = 100  # near the edge -> vehicle needs paved + flat terrain
# Terrain-flatness probe for vehicle's relaxed-snap grace.
FLAT_TERRAIN_DELTA_M = 5
FLAT_SAMPLE_RADIUS_M = 50

# Spatial eligibility vocabulary. Valhalla's verbose /locate exposes the road grade
# under classification.classification (PAVED below) and the edge purpose under
# classification.use (TRACK/PATH below) — track/path/footway are NOT road grades.
PAVED_HIGHWAY_CLASSES = frozenset({
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "unclassified", "residential", "service", "service_other",
})
TRACK_USE_VALUES = frozenset({"track"})
PATH_USE_VALUES = frozenset({
    "path", "footway", "cycleway", "bridleway", "steps", "pedestrian",
})

# Mode to Valhalla costing mapping
MODE_TO_COSTING = {
    "auto": "auto",
    "foot": "pedestrian",
    "2w": "bicycle",
    "4w": "auto",
    "vehicle": "auto",
}

# Fixed mode index ordering for the unified-graph kernel (spec §2.1; == MODE_INDEX in
# transitions.py). The cost_mult_stack / per-mode arrays are packed in this order.
MODE_ORDER = ["foot", "2w", "4w", "vehicle"]

# Per-endpoint travel-mode eligibility from an OSM-style "key:value" category hint.
# Looked up exact first, then "key:*" wildcard (see _eligible_modes_from_category).
_MODES_ALL = frozenset({"vehicle", "4w", "2w", "foot"})
_MODES_TRACK = frozenset({"4w", "2w", "foot"})
_MODES_PATH = frozenset({"2w", "foot"})
_MODES_FOOT = frozenset({"foot"})

CATEGORY_ELIGIBLE_MODES = {
    # Address-like -> full access
    "highway:motorway": _MODES_ALL, "highway:trunk": _MODES_ALL,
    "highway:primary": _MODES_ALL, "highway:secondary": _MODES_ALL,
    "highway:tertiary": _MODES_ALL, "highway:unclassified": _MODES_ALL,
    "highway:residential": _MODES_ALL, "highway:service": _MODES_ALL,
    "building:*": _MODES_ALL, "amenity:*": _MODES_ALL,
    "shop:*": _MODES_ALL, "office:*": _MODES_ALL,
    "tourism:hotel": _MODES_ALL, "tourism:motel": _MODES_ALL,
    "tourism:guest_house": _MODES_ALL, "tourism:hostel": _MODES_ALL,
    "tourism:apartment": _MODES_ALL,
    "leisure:park": _MODES_ALL,
    "place:city": _MODES_ALL, "place:town": _MODES_ALL,
    "place:village": _MODES_ALL, "place:hamlet": _MODES_ALL,
    "place:suburb": _MODES_ALL, "place:neighbourhood": _MODES_ALL,
    "railway:station": _MODES_ALL,
    # Track-like -> 4w/2w/foot
    "highway:track": _MODES_TRACK, "highway:trailhead": _MODES_TRACK,
    # Path-like -> 2w/foot
    "highway:path": _MODES_PATH, "highway:bridleway": _MODES_PATH,
    # Foot-only
    "highway:footway": _MODES_FOOT, "highway:steps": _MODES_FOOT,
    "highway:pedestrian": _MODES_FOOT,
    "natural:*": _MODES_FOOT,
    "place:roadless_area": _MODES_FOOT, "place:protected_area": _MODES_FOOT,
    "landuse:forest": _MODES_FOOT, "landuse:nature_reserve": _MODES_FOOT,
    "tourism:camp_site": _MODES_FOOT, "tourism:picnic_site": _MODES_FOOT,
    "tourism:viewpoint": _MODES_FOOT,
}

# Mode to valid entry point highway classes
# foot = any trail/track/road, 2w = tracks and roads, vehicle = roads only
MODE_TO_VALID_HIGHWAYS = {
    "auto": {"primary", "secondary", "tertiary", "unclassified", "residential",
             "service"},
    "foot": {"primary", "secondary", "tertiary", "unclassified", "residential",
             "service", "track", "path", "footway", "bridleway"},
    "2w": {"primary", "secondary", "tertiary", "unclassified", "residential",
            "service", "track"},
    "4w": {"primary", "secondary", "tertiary", "unclassified", "residential",
            "service", "track"},
    "vehicle": {"primary", "secondary", "tertiary", "unclassified", "residential",
                "service"},
}


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in meters."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def check_memory_usage() -> float:
    """Current process RSS in GB."""
    return psutil.Process().memory_info().rss / (1024**3)


class EntryPointIndex:
    """
    PostGIS-backed spatial index of road/trail entry points.
    Uses ST_DWithin for fast radius queries with meter-accurate distances.
    Densifies highway LineStrings at 100m intervals for better coverage.
    """

    def __init__(self, dsn: str = None):
        self.dsn = dsn or POSTGIS_DSN
        self._conn: Optional[psycopg2.extensions.connection] = None

    def _get_conn(self) -> psycopg2.extensions.connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self.dsn)
        return self._conn

    def table_exists(self) -> bool:
        """Check if entry_points table exists."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'entry_points'
                )
            """)
            return cur.fetchone()[0]

    def get_entry_point_count(self) -> int:
        """Return the number of entry points in the index."""
        if not self.table_exists():
            return 0
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM entry_points")
            return cur.fetchone()[0]

    def has_entry_points(self) -> bool:
        """Fast non-emptiness check. SELECT EXISTS short-circuits at the first row,
        unlike SELECT COUNT(*) which scans the entire table (~73s on 2.94M rows).
        Returns False if the table is absent."""
        if not self.table_exists():
            return False
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT EXISTS (SELECT 1 FROM entry_points LIMIT 1)")
            return cur.fetchone()[0]

    def query_bbox(
        self,
        south: float,
        north: float,
        west: float,
        east: float,
        valid_highways: Optional[Set[str]] = None
    ) -> List[Dict]:
        """Find entry points within a bounding box."""
        if not self.table_exists():
            return []

        conn = self._get_conn()

        highway_filter = ""
        params = [west, south, east, north]
        if valid_highways:
            placeholders = ','.join(['%s'] * len(valid_highways))
            highway_filter = f"AND highway_class IN ({placeholders})"
            params.extend(list(valid_highways))

        query = f"""
            SELECT
                id,
                ST_Y(geom) as lat,
                ST_X(geom) as lon,
                highway_class,
                name,
                land_status
            FROM entry_points
            WHERE geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            {highway_filter}
        """

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            return [dict(row) for row in cur.fetchall()]

    def query_radius(
        self,
        lat: float,
        lon: float,
        radius_km: float,
        valid_highways: Optional[Set[str]] = None,
        limit: int = 50
    ) -> List[Dict]:
        """
        Find the nearest entry points to (lat, lon), ordered by true geodesic distance.

        Uses PostGIS k-NN ordering (the geography ``<->`` operator), which is
        index-assisted by the GiST index on ``(geom::geography)``: it walks the index
        nearest-first and stops after ``limit`` rows, instead of scanning every point
        inside a radius (the old ST_DWithin approach returned ~226k candidates near
        dense areas before sorting). ``radius_km`` is retained as a *soft cap* applied
        in Python after the fetch — rows beyond it are dropped, so callers'
        expanded-radius fallback still works (though it is now effectively a no-op,
        since k-NN already returns the globally nearest K regardless of radius).
        """
        if not self.table_exists():
            return []

        conn = self._get_conn()

        # SELECT distance_m needs the point; optional highway filter; ORDER BY <-> needs
        # the point again; then LIMIT. Param order follows the placeholders top-to-bottom.
        highway_filter = ""
        params = [lon, lat]
        if valid_highways:
            placeholders = ','.join(['%s'] * len(valid_highways))
            highway_filter = f"WHERE highway_class IN ({placeholders})"
            params.extend(list(valid_highways))
        params.extend([lon, lat, limit])

        query = f"""
            SELECT
                id,
                ST_Y(geom) as lat,
                ST_X(geom) as lon,
                highway_class,
                name,
                land_status,
                ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_Point(%s, %s), 4326)::geography
                ) as distance_m
            FROM entry_points
            {highway_filter}
            ORDER BY geom::geography <-> ST_SetSRID(ST_Point(%s, %s), 4326)::geography
            LIMIT %s
        """

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            rows = [dict(row) for row in cur.fetchall()]

        # radius_km soft cap (backward compat): drop rows beyond it.
        radius_m = radius_km * 1000
        return [r for r in rows if r["distance_m"] <= radius_m]

    def build_index(self, osm_pbf_path: Path = None) -> Dict:
        """
        Build the entry point index from OSM PBF.
        Densifies LineStrings to sample points every 100m.
        Tags points with land_status from PAD-US.
        """
        if osm_pbf_path is None:
            osm_pbf_path = OSM_PBF_PATH

        if not osm_pbf_path.exists():
            raise FileNotFoundError(f"OSM PBF not found: {osm_pbf_path}")

        print(f"Building entry point index from {osm_pbf_path}...")
        start_time = time.time()

        highway_types = [
            "primary", "secondary", "tertiary", "unclassified",
            "residential", "service", "track", "path", "footway", "bridleway"
        ]

        stats = {"total": 0, "by_class": {}, "lines_processed": 0}

        with tempfile.TemporaryDirectory() as tmpdir:
            geojson_path = Path(tmpdir) / "highways.geojson"

            # Extract highways with osmium
            print("  Extracting highways with osmium...")
            cmd = ["osmium", "tags-filter", str(osm_pbf_path)]
            for ht in highway_types:
                cmd.append(f"w/highway={ht}")
            cmd.extend(["-o", str(Path(tmpdir) / "filtered.osm.pbf"), "--overwrite"])
            subprocess.run(cmd, check=True, capture_output=True)

            # Convert to GeoJSON
            print("  Converting to GeoJSON with ogr2ogr...")
            cmd = [
                "ogr2ogr", "-f", "GeoJSON",
                str(geojson_path),
                str(Path(tmpdir) / "filtered.osm.pbf"),
                "lines", "-t_srs", "EPSG:4326"
            ]
            subprocess.run(cmd, check=True, capture_output=True)

            # Load GeoJSON
            print("  Loading GeoJSON...")
            with open(geojson_path) as f:
                data = json.load(f)

            # Process features and densify
            print(f"  Densifying LineStrings at {DENSIFY_INTERVAL_M}m intervals...")
            points_to_insert = []
            seen_keys = set()

            features = data.get("features", [])
            total_features = len(features)

            for idx, feature in enumerate(features):
                if idx > 0 and idx % 100000 == 0:
                    print(f"    Processed {idx}/{total_features} features...")

                props = feature.get("properties", {})
                geom = feature.get("geometry", {})

                if geom.get("type") != "LineString":
                    continue

                coords = geom.get("coordinates", [])
                if len(coords) < 2:
                    continue

                highway_class = props.get("highway", "unknown")
                name = props.get("name", "")
                stats["lines_processed"] += 1

                # Densify this LineString
                densified = self._densify_line(coords, DENSIFY_INTERVAL_M)

                for lon, lat in densified:
                    # Deduplicate by rounding to 5 decimal places (~1m precision)
                    key = (round(lat, 5), round(lon, 5))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    points_to_insert.append((lon, lat, highway_class, name))

        # Insert into PostGIS
        print(f"  Inserting {len(points_to_insert)} entry points into PostGIS...")
        conn = self._get_conn()

        with conn.cursor() as cur:
            # Truncate existing data
            cur.execute("TRUNCATE entry_points RESTART IDENTITY")

            # Batch insert with execute_values for speed
            batch_size = 50000
            for i in range(0, len(points_to_insert), batch_size):
                batch = points_to_insert[i:i+batch_size]
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO entry_points (geom, highway_class, name)
                    VALUES %s
                    """,
                    batch,
                    template="(ST_SetSRID(ST_Point(%s, %s), 4326), %s, %s)",
                    page_size=10000
                )
                if i > 0 and i % 500000 == 0:
                    print(f"    Inserted {i}/{len(points_to_insert)} points...")

        conn.commit()

        # Tag land_status from PAD-US
        print("  Tagging land_status from PAD-US subdivided polygons...")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE entry_points e
                SET land_status = 'public'
                FROM padus_sub p
                WHERE ST_Intersects(e.geom, p.geom)
            """)
            public_count = cur.rowcount
            print(f"    Tagged {public_count} points as public land")

        conn.commit()

        # Gather stats
        elapsed = time.time() - start_time
        stats["total"] = len(points_to_insert)
        stats["build_time_sec"] = round(elapsed, 1)

        for lon, lat, hc, name in points_to_insert:
            stats["by_class"][hc] = stats["by_class"].get(hc, 0) + 1

        print(f"  Done in {elapsed:.1f}s. Total: {stats['total']} entry points from {stats['lines_processed']} lines")
        for hc, count in sorted(stats["by_class"].items(), key=lambda x: -x[1]):
            print(f"    {hc}: {count}")

        return stats

    def _densify_line(self, coords: List[List[float]], interval_m: float) -> List[tuple]:
        """
        Sample points along a LineString at regular intervals.
        coords: [[lon, lat], ...] in GeoJSON order
        Returns: [(lon, lat), ...] sampled points including first and last
        """
        if len(coords) < 2:
            return [(coords[0][0], coords[0][1])] if coords else []

        # Calculate line length in meters using haversine on segments
        total_m = 0
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i]
            lon2, lat2 = coords[i + 1]
            total_m += haversine_distance(lat1, lon1, lat2, lon2)

        if total_m == 0:
            return [(coords[0][0], coords[0][1])]

        # Create Shapely LineString
        line = LineString(coords)

        # Calculate number of points needed
        n_points = max(2, int(total_m / interval_m) + 1)

        # Sample using normalized interpolation
        result = []
        for i in range(n_points):
            fraction = min(i / (n_points - 1), 1.0) if n_points > 1 else 0
            point = line.interpolate(fraction, normalized=True)
            result.append((point.x, point.y))  # (lon, lat)

        # Always ensure first and last original coordinates are included
        first_coord = (coords[0][0], coords[0][1])
        last_coord = (coords[-1][0], coords[-1][1])

        if result[0] != first_coord:
            result[0] = first_coord
        if result[-1] != last_coord:
            result[-1] = last_coord

        return result

    def _highway_priority(self, highway_class: str) -> int:
        """Lower number = better priority for entry points."""
        priority = {
            "primary": 1, "secondary": 2, "tertiary": 3,
            "unclassified": 4, "residential": 5, "service": 6,
            "track": 7, "path": 8, "footway": 9, "bridleway": 10
        }
        return priority.get(highway_class, 99)

    def close(self):
        if self._conn and not self._conn.closed:
            self._conn.close()
            self._conn = None


class OffrouteRouter:
    """
    OFFROUTE Router — orchestrates wilderness pathfinding and Valhalla stitching.

    Supports four scenarios:
      A: off-network start → on-network end
      B: off-network start → off-network end
      C: on-network start → off-network end
      D: on-network start → on-network end (pure Valhalla)

    IMPORTANT: Wilderness segment ALWAYS uses foot mode for pathfinding.
    User's mode affects entry point selection and Valhalla costing only.
    """

    def __init__(self):
        self.dem_reader = None
        self.friction_reader = None
        self.barrier_reader = None
        self.wilderness_reader = None
        self.trail_reader = None
        self.entry_index = EntryPointIndex()
        self.spatial_index = None   # MVUMSpatialIndex (Layer 0), injected by the handler
        self.mvum_on_date = None    # optional datetime for seasonal MVUM checks
        self._exclude_polygons = None  # MVUM Layer 2c, set per route() call
        self.trailhead_index = None    # TrailheadIndex (Layer 3a), injected by the handler
        self.parking_index = None      # OSMParkingIndex (Layer 3b), injected by the handler

    def _init_readers(self):
        """Lazy init readers."""
        if self.dem_reader is None:
            self.dem_reader = DEMReader(dem_path())   # NAVI_DEM_PMTILES via shared.dem
        if self.friction_reader is None:
            self.friction_reader = FrictionReader()
        if self.barrier_reader is None:
            self.barrier_reader = BarrierReader()
        if self.wilderness_reader is None and wilderness_tif_path().exists():
            self.wilderness_reader = WildernessReader()
        if self.trail_reader is None:
            self.trail_reader = TrailReader()

    def _locate_on_network(self, lat: float, lon: float, mode: str) -> Dict:
        """
        Check if a point is on the routable network using Valhalla's /locate.

        Returns:
            {
                "on_network": bool,
                "snap_distance_m": float,
                "snapped_lat": float,
                "snapped_lon": float
            }
        """
        costing = MODE_TO_COSTING.get(mode, "pedestrian")
        try:
            resp = requests.post(
                f"{VALHALLA_URL}/locate",
                json={"locations": [{"lat": lat, "lon": lon}], "costing": costing, "verbose": True},
                timeout=10
            )

            if resp.status_code == 200:
                data = resp.json()
                if data and len(data) > 0 and data[0].get("edges"):
                    edge = data[0]["edges"][0]
                    snap_lat = edge.get("correlated_lat", lat)
                    snap_lon = edge.get("correlated_lon", lon)
                    snap_dist = haversine_distance(lat, lon, snap_lat, snap_lon)
                    return {
                        "on_network": snap_dist <= OFF_NETWORK_THRESHOLD_M,
                        "snap_distance_m": snap_dist,
                        "snapped_lat": snap_lat,
                        "snapped_lon": snap_lon,
                        # Valhalla (verbose=true) puts the road grade under
                        # edge.classification.classification and the edge purpose under
                        # edge.classification.use; defensive .get chains -> None if absent.
                        "road_class": edge.get("edge", {}).get("classification", {}).get("classification"),
                        "use": edge.get("edge", {}).get("classification", {}).get("use"),
                    }
        except Exception:
            pass

        return {
            "on_network": False,
            "snap_distance_m": float('inf'),
            "snapped_lat": lat,
            "snapped_lon": lon,
            "road_class": None,
            "use": None,
        }

    def route(
        self,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
        mode: Literal["auto", "foot", "2w", "4w", "vehicle"] = "foot",
        boundary_mode: Literal["strict", "pragmatic", "emergency"] = "pragmatic",
        start_category: Optional[str] = None,
        end_category: Optional[str] = None,
        annotate_mvum: bool = True,
        network_affinity: Optional[Dict[str, float]] = None,
    ) -> Dict:
        """
        Route between two points, handling all four scenarios.

        Scenarios:
            A: off-network start → on-network end (wilderness then network)
            B: off-network start → off-network end (wilderness, network, wilderness)
            C: on-network start → off-network end (network then wilderness)
            D: on-network start → on-network end (pure network)

        Args:
            start_lat, start_lon: Starting coordinates
            end_lat, end_lon: Destination coordinates
            mode: Travel mode (foot, 2w, 4w, vehicle)
            boundary_mode: How to handle private land (strict, pragmatic, emergency)

        Returns a GeoJSON FeatureCollection with route segments.
        """
        if mode == "auto":
            return self._route_auto(
                start_lat, start_lon, end_lat, end_lon, boundary_mode,
                start_category, end_category, network_affinity
            )

        if mode not in MODE_TO_COSTING:
            return {"status": "error", "message": f"Unknown mode: {mode}"}

        # MVUM Layer 2c: precompute closed-segment exclusion polygons for this mode
        # (strict boundary only). Both Valhalla call sites read self._exclude_polygons.
        self._exclude_polygons = build_exclude_polygons(
            start_lat, start_lon, end_lat, end_lon, mode,
            getattr(self, "spatial_index", None), getattr(self, "mvum_on_date", None),
            boundary_mode)

        # Vehicle is pure Valhalla road routing: Valhalla snaps endpoints to the
        # nearest road automatically, so the off-network classifier is irrelevant
        # (and a tight threshold would wrongly push normal road routes into
        # wilderness pathfinding). Foot/MTB/ATV still use the threshold gate so
        # users can intentionally pin backcountry points. Auto inherits this via
        # its recursive self.route(..., mode="vehicle", ...) probe.
        if mode == "vehicle":
            result = self._route_D_network_only(
                start_lat, start_lon, end_lat, end_lon, mode
            )
        else:
            # Detect network status for both endpoints
            start_status = self._locate_on_network(start_lat, start_lon, mode)
            end_status = self._locate_on_network(end_lat, end_lon, mode)

            start_off_network = not start_status["on_network"]
            end_off_network = not end_status["on_network"]

            # Dispatch to appropriate handler
            if not start_off_network and not end_off_network:
                # Scenario D: on-network → on-network (pure Valhalla)
                result = self._route_D_network_only(
                    start_lat, start_lon, end_lat, end_lon, mode
                )
            elif not start_off_network and end_off_network:
                # Scenario C: on-network → off-network
                result = self._route_C_network_to_wilderness(
                    start_lat, start_lon, end_lat, end_lon, mode, boundary_mode
                )
            elif start_off_network and not end_off_network:
                # Scenario A: off-network → on-network
                result = self._route_A_wilderness_to_network(
                    start_lat, start_lon, end_lat, end_lon, mode, boundary_mode
                )
            else:
                # Scenario B: off-network → off-network
                result = self._route_B_wilderness_both(
                    start_lat, start_lon, end_lat, end_lon, mode, boundary_mode
                )

        # MVUM Layer 1: annotate the network leg in one central pass. Auto annotates only
        # its winning candidate (see _route_auto), so probing does not re-annotate.
        if annotate_mvum and isinstance(result, dict) and result.get("status") == "ok":
            self._annotate_network_segments(result, mode)
        return result

    def _annotate_network_segments(self, result, mode):
        """Mutate result in place: attach edge_mvum to each network feature and write
        mvum_closed_crossings + mvum_segments_annotated into the summary."""
        if not isinstance(result, dict) or result.get("status") != "ok":
            return
        if getattr(self, "spatial_index", None) is None:
            return
        on_date = getattr(self, "mvum_on_date", None) or datetime.now()
        features = (result.get("route") or {}).get("features", [])
        total_closed = 0
        total_annotated = 0
        for feat in features:
            props = feat.get("properties") or {}
            # network features are tagged segment_type == "network"
            if props.get("segment_type") != "network":
                continue
            coords = (feat.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            edges = annotate_network_edges(
                [(c[1], c[0]) for c in coords], mode, self.spatial_index, on_date)
            props["edge_mvum"] = [e.to_dict() for e in edges]
            total_closed += sum(1 for e in edges if e.mvum_status == "closed")
            total_annotated += len(edges)
        summary = result.setdefault("summary", {})
        summary["mvum_closed_crossings"] = total_closed
        summary["mvum_segments_annotated"] = total_annotated

    def _eligible_modes_from_category(self, category: Optional[str]):
        """Eligible travel modes for an OSM "key:value" category hint, or None if the
        category is empty/unknown. Exact match first, then a "key:*" wildcard."""
        if not category:
            return None
        modes = CATEGORY_ELIGIBLE_MODES.get(category)
        if modes is not None:
            return modes
        if ":" in category:
            key = category.split(":", 1)[0]
            return CATEGORY_ELIGIBLE_MODES.get(f"{key}:*")
        return None

    def _is_terrain_flat(self, lat: float, lon: float) -> bool:
        """True if the DEM is flat (max-min < FLAT_TERRAIN_DELTA_M) across the center
        and four cardinal points FLAT_SAMPLE_RADIUS_M away. Conservative: any DEM read
        failure (untiled/ocean/error) returns False, so unknown terrain earns no grace."""
        try:
            if self.dem_reader is None:
                self.dem_reader = DEMReader(dem_path())
            dlat = FLAT_SAMPLE_RADIUS_M / 111320.0
            dlon = FLAT_SAMPLE_RADIUS_M / (111320.0 * max(0.01, math.cos(math.radians(lat))))
            pts = [(lat, lon), (lat + dlat, lon), (lat - dlat, lon),
                   (lat, lon + dlon), (lat, lon - dlon)]
            elevs = [self.dem_reader.sample_point(la, lo) for la, lo in pts]
            if any(e is None for e in elevs):
                return False
            return (max(elevs) - min(elevs)) < FLAT_TERRAIN_DELTA_M
        except Exception:
            return False

    def _spatial_eligible_modes(self, lat: float, lon: float, snap_cache: dict):
        """Eligible modes for an UNTYPED endpoint, derived from Valhalla /locate snaps.
        Runs the three distinct costings (auto/pedestrian/bicycle) in parallel and
        applies the per-mode snap-distance + road-class rules. snap_cache dedupes
        /locate results within a single request.

        Spec §6 reframe: under unified-graph Auto this is now a SEED generator (it
        feeds origin/goal modes to astar_multigoal_multimode), not the load-bearing
        single-mode chooser it was. Behaviour/return shape are unchanged. The §6
        single-combined-/locate batch is a Phase-4 follow-up; the 3-call pattern stays
        until the batch response shape is confirmed against the live instance."""
        # auto costing -> vehicle/4w reach, bicycle -> 2w reach, pedestrian -> foot
        costing_modes = {"auto": "vehicle", "pedestrian": "foot", "bicycle": "2w"}
        need = [c for c in costing_modes if (lat, lon, c) not in snap_cache]
        if need:
            with ThreadPoolExecutor(max_workers=3) as ex:
                futs = {ex.submit(self._locate_on_network, lat, lon, costing_modes[c]): c
                        for c in need}
                for fut in as_completed(futs):
                    snap_cache[(lat, lon, futs[fut])] = fut.result()

        auto_snap = snap_cache[(lat, lon, "auto")]
        bike_snap = snap_cache[(lat, lon, "bicycle")]
        d_auto = auto_snap["snap_distance_m"]
        cls_auto, use_auto = auto_snap.get("road_class"), auto_snap.get("use")
        d_bike = bike_snap["snap_distance_m"]
        cls_bike, use_bike = bike_snap.get("road_class"), bike_snap.get("use")

        modes = {"foot"}  # foot is always eligible
        # vehicle: on a paved road (tight), or near one if paved AND flat (relaxed)
        if (d_auto <= AUTO_SNAP_TIGHT_M and cls_auto in PAVED_HIGHWAY_CLASSES) or \
           (d_auto <= AUTO_SNAP_RELAXED_M and cls_auto in PAVED_HIGHWAY_CLASSES
                and self._is_terrain_flat(lat, lon)):
            modes.add("vehicle")
        # 4w: near a paved road OR a track (auto costing)
        if d_auto <= AUTO_SNAP_RELAXED_M and (
                cls_auto in PAVED_HIGHWAY_CLASSES or use_auto in TRACK_USE_VALUES):
            modes.add("4w")
        # 2w: near a paved road OR a track/path (bicycle costing)
        if d_bike <= AUTO_SNAP_RELAXED_M and (
                cls_bike in PAVED_HIGHWAY_CLASSES
                or use_bike in (TRACK_USE_VALUES | PATH_USE_VALUES)):
            modes.add("2w")
        return frozenset(modes)

    def _route_auto(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        boundary_mode: str,
        start_category: Optional[str] = None,
        end_category: Optional[str] = None,
        network_affinity: Optional[Dict[str, float]] = None,
    ) -> Dict:
        """Unified-graph Auto (spec §2.4): ONE A* over (row, col, mode). Endpoint
        eligibility only SEEDS the start/goal modes (§6); the optimizer decides where to
        switch modes (parking / trailhead / road terminus / surface change) instead of
        committing to a single trip-wide mode. Supersedes the capability pick + single
        self.route() + _try_hybrid_auto + foot-fallback flow (deleted in Phase 5).
        No auto_fallback_from (§7)."""
        # 1. Bootstrap eligibility -> seeds (not a routing decision).
        snap_cache: dict = {}
        start_eligible = self._auto_eligible_modes(start_lat, start_lon, start_category, snap_cache)
        end_eligible = self._auto_eligible_modes(end_lat, end_lon, end_category, snap_cache)
        seed_set = sorted(start_eligible | end_eligible)

        # 2-3. bbox covering both endpoints + the shared rasters (one fetch, all modes).
        try:
            (elevation, friction_mult, friction_raw, trails, barriers,
             wilderness, mvum_by_mode, meta) = self._fetch_auto_rasters(
                start_lat, start_lon, end_lat, end_lon)
        except Exception as e:
            logger.exception("auto: raster fetch failed")
            return {"status": "error", "message": f"Failed to load terrain: {e}",
                    "selected_mode_set": seed_set}
        rows, cols = elevation.shape

        # Endpoints -> pixels (mirror the existing entry-point convention).
        origin_row, origin_col = self.dem_reader.latlon_to_pixel(start_lat, start_lon, meta)
        goal_row, goal_col = self.dem_reader.latlon_to_pixel(end_lat, end_lon, meta)
        if not (0 <= origin_row < rows and 0 <= origin_col < cols
                and 0 <= goal_row < rows and 0 <= goal_col < cols):
            return {"status": "error", "message": "Endpoint outside grid bounds",
                    "selected_mode_set": seed_set}

        # 4. Per-mode cost layers (+ MVUM closures + network_affinity) and transition cells.
        layers = compute_unified_cost_layers(
            elevation, friction_mult, friction_raw, trails, wilderness, meta,
            modes=tuple(MODE_ORDER), boundary_mode=boundary_mode,
            endpoint_line=((start_lat, start_lon), (end_lat, end_lon)),
            valhalla_url=VALHALLA_URL,
            mvum_by_mode=mvum_by_mode, network_affinity=network_affinity)

        # 5-6. Pack the per-mode arrays the kernel expects (MODE_ORDER == MODE_INDEX order).
        n_modes = len(MODE_ORDER)
        cost_mult = layers["cost_mult"]
        cost_mult_stack = np.empty((rows, cols, n_modes), dtype=np.float64)
        trail_friction_stack = np.full((n_modes, 256), np.inf, dtype=np.float64)
        max_grade_arr = np.empty(n_modes, dtype=np.float64)
        speed_function_ids = np.empty(n_modes, dtype=np.int64)
        base_speed_kmh_arr = np.empty(n_modes, dtype=np.float64)
        sf_id = {"tobler": 0, "herzog": 1, "linear": 2}
        net_aff = network_affinity or {}
        for mi, mname in enumerate(MODE_ORDER):
            cost_mult_stack[:, :, mi] = cost_mult[mname]
            prof = MODE_PROFILES[mname]
            # §8 network_affinity also scales this mode's on-network (trail) edges: the
            # kernel costs on-trail edges from trail_friction, NOT cost_mult, so the cost_mult
            # bias in compute_unified_cost_layers only reaches off-network cells. >1 penalizes
            # staying on the network, <1 biases toward it; default 1.0 is a no-op.
            aff = float(net_aff.get(mname, 1.0))
            for tv, fric in prof.trail_friction.items():
                trail_friction_stack[mi, tv] = np.inf if fric is None else float(fric) * aff
            max_grade_arr[mi] = float(np.tan(np.radians(prof.max_slope_deg)))
            speed_function_ids[mi] = sf_id.get(prof.speed_function, 0)
            base_speed_kmh_arr[mi] = float(prof.base_speed_kmh)

        origin_modes = np.array(sorted(MODE_INDEX[m] for m in start_eligible), dtype=np.int64)
        goal_modes = np.array(sorted(MODE_INDEX[m] for m in end_eligible), dtype=np.int64)

        # 7. Unpack transition cells into the kernel's flat 1D arrays.
        tc = layers["transition_cells"]
        nt = len(tc)
        trans_rows = np.empty(nt, dtype=np.int64)
        trans_cols = np.empty(nt, dtype=np.int64)
        trans_from = np.empty(nt, dtype=np.int64)
        trans_to = np.empty(nt, dtype=np.int64)
        trans_cost = np.empty(nt, dtype=np.float64)
        for i, (tr, tcl, fm, tm, cs) in enumerate(tc):
            trans_rows[i], trans_cols[i], trans_from[i], trans_to[i], trans_cost[i] = tr, tcl, fm, tm, cs

        # 8. Single unified search.
        cell_m = float(meta["cell_size_m"])
        trail_grid = np.ascontiguousarray(
            trails if trails is not None else np.zeros((rows, cols), np.uint8), dtype=np.uint8)
        barrier_grid = np.ascontiguousarray(
            barriers if barriers is not None else np.zeros((rows, cols), np.uint8), dtype=np.uint8)
        boundary_mode_id = {"strict": 0, "pragmatic": 1, "emergency": 2}.get(boundary_mode, 1)
        _t0 = time.perf_counter()
        best_idx, path, total_cost = astar_multigoal_multimode(
            np.ascontiguousarray(cost_mult_stack), elevation, cell_m, cell_m,
            max_grade_arr, speed_function_ids, base_speed_kmh_arr,
            trail_grid, trail_friction_stack, barrier_grid, boundary_mode_id,
            int(origin_row), int(origin_col), origin_modes,
            np.array([goal_row], dtype=np.int64), np.array([goal_col], dtype=np.int64), goal_modes,
            trans_rows, trans_cols, trans_from, trans_to, trans_cost)
        logger.info("auto: unified A* (%d transition cells) in %.2fs",
                    nt, time.perf_counter() - _t0)

        if best_idx < 0 or path.shape[0] == 0:
            return {"status": "error", "message": "No unified route found",
                    "selected_mode_set": seed_set}

        # 9. Render per-mode segments + transition markers (no auto_fallback_from, §7).
        return self._render_unified_path(path, total_cost, meta, boundary_mode)

    def _auto_eligible_modes(self, lat, lon, category, snap_cache):
        """Seed modes for one endpoint: category type-hint when present, else the
        reframed spatial probe (§6). foot is always eligible."""
        typed = self._eligible_modes_from_category(category)
        if typed is not None:
            return frozenset(typed) | {"foot"}
        return frozenset(self._spatial_eligible_modes(lat, lon, snap_cache)) | {"foot"}

    def _fetch_auto_rasters(self, start_lat, start_lon, end_lat, end_lon):
        """Fetch the shared rasters for one unified Auto search over a bbox covering both
        endpoints (+ pad, clamped), via the existing reader objects. Returns
        (elevation, friction_mult, friction_raw, trails, barriers, wilderness,
        mvum_by_mode, meta)."""
        self._init_readers()
        pad = 0.02
        bbox = {"south": min(start_lat, end_lat) - pad, "north": max(start_lat, end_lat) + pad,
                "west": min(start_lon, end_lon) - pad, "east": max(start_lon, end_lon) + pad}
        MAX = 2.0
        if (bbox["north"] - bbox["south"] > MAX) or (bbox["east"] - bbox["west"] > MAX):
            clat, clon, h = (start_lat + end_lat) / 2, (start_lon + end_lon) / 2, MAX / 2
            bbox = {"south": clat - h, "north": clat + h, "west": clon - h, "east": clon + h}
        elevation, meta = self.dem_reader.get_elevation_grid(
            south=bbox["south"], north=bbox["north"], west=bbox["west"], east=bbox["east"])
        shape = elevation.shape
        friction_raw = self.friction_reader.get_friction_grid(
            south=bbox["south"], north=bbox["north"], west=bbox["west"], east=bbox["east"],
            target_shape=shape)
        friction_mult = friction_to_multiplier(friction_raw)
        barriers = self.barrier_reader.get_barrier_grid(
            south=bbox["south"], north=bbox["north"], west=bbox["west"], east=bbox["east"],
            target_shape=shape)
        trails = self.trail_reader.get_trails_grid(
            south=bbox["south"], north=bbox["north"], west=bbox["west"], east=bbox["east"],
            target_shape=shape)
        wilderness = None
        if self.wilderness_reader is not None:
            wilderness = self.wilderness_reader.get_wilderness_grid(
                south=bbox["south"], north=bbox["north"], west=bbox["west"], east=bbox["east"],
                target_shape=shape)
        mvum_by_mode = self._build_mvum_by_mode(bbox, shape)
        elevation = np.ascontiguousarray(elevation, dtype=np.float64)
        return (elevation, friction_mult, friction_raw, trails, barriers,
                wilderness, mvum_by_mode, meta)

    def _build_mvum_by_mode(self, bbox, shape):
        """Per-mode MVUM access rasters for the motorized modes, baked into the cost
        layers (spec §9): get_mvum_access_grid -> 0=unknown/1=open/255=closed. Best-effort
        -> returns None (graceful degradation, spec §16 risk register) when the MVUM DB is
        unavailable (e.g. tests without navi.db)."""
        mvum_mode = {"2w": "mtb", "4w": "atv", "vehicle": "vehicle"}
        on_date = getattr(self, "mvum_on_date", None)
        check = on_date.strftime("%m/%d") if on_date else None
        out = {}
        for mode, mv_name in mvum_mode.items():
            try:
                out[mode] = get_mvum_access_grid(
                    bbox["south"], bbox["north"], bbox["west"], bbox["east"],
                    target_shape=shape, mode=mv_name, check_date=check)
            except Exception as e:
                logger.info("auto: MVUM grid unavailable for %s: %s", mode, e)
        return out or None

    def _append_unified_segment(self, features, seg_coords, mode_idx):
        """One per-mode LineString feature (skipped if < 2 coords, e.g. a transition-only
        cell). network_mode drives the map's per-segment colour (Phase 6)."""
        if len(seg_coords) < 2:
            return
        features.append({
            "type": "Feature",
            "properties": {"segment_type": "unified", "mode": MODE_ORDER[mode_idx],
                           "network_mode": MODE_ORDER[mode_idx]},
            "geometry": {"type": "LineString", "coordinates": list(seg_coords)},
        })

    def _render_unified_path(self, path, total_cost, meta, boundary_mode):
        """Render the (N,3) (row, col, mode) unified path into the GeoJSON response shape
        (per-mode LineString segments + transition Point markers at mode-change cells + a
        combined full-path line), matching _build_response.
        selected_mode_set = sorted distinct modes used; NO auto_fallback_from (spec §7)."""
        n = path.shape[0]
        coords = []
        for i in range(n):
            lat, lon = self.dem_reader.pixel_to_latlon(int(path[i, 0]), int(path[i, 1]), meta)
            coords.append([lon, lat])
        modes = [int(path[i, 2]) for i in range(n)]

        features = []
        transitions = []
        seg_start = 0
        for i in range(1, n):
            if modes[i] != modes[i - 1]:
                self._append_unified_segment(features, coords[seg_start:i], modes[i - 1])
                transitions.append((coords[i], modes[i - 1], modes[i]))
                seg_start = i
        self._append_unified_segment(features, coords[seg_start:n], modes[n - 1])

        for (xy, fm, tm) in transitions:
            features.append({
                "type": "Feature",
                "properties": {"segment_type": "transition", "kind": "transition",
                               "lat": xy[1], "lon": xy[0],
                               "from_mode": MODE_ORDER[fm], "to_mode": MODE_ORDER[tm]},
                "geometry": {"type": "Point", "coordinates": [xy[0], xy[1]]},
            })

        combined = []
        for xy in coords:
            if not combined or combined[-1] != xy:
                combined.append(xy)
        if len(combined) >= 2:
            features.append({
                "type": "Feature",
                "properties": {"segment_type": "combined", "boundary_mode": boundary_mode,
                               "scenario": "unified"},
                "geometry": {"type": "LineString", "coordinates": combined},
            })

        total_m = sum(haversine_distance(combined[i][1], combined[i][0],
                                         combined[i + 1][1], combined[i + 1][0])
                      for i in range(len(combined) - 1))
        selected_mode_set = sorted({MODE_ORDER[m] for m in modes})
        return {
            "status": "ok",
            "route": {"type": "FeatureCollection", "features": features},
            "summary": {
                "total_distance_km": total_m / 1000.0,
                "total_effort_minutes": float(total_cost) / 60.0,
                "scenario": "unified",
                "boundary_mode": boundary_mode,
                "selected_mode_set": selected_mode_set,
            },
            "selected_mode": selected_mode_set[0] if len(selected_mode_set) == 1 else "hybrid",
            "selected_mode_set": selected_mode_set,
            "scenario": "unified",
        }

    def _route_D_network_only(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        mode: str
    ) -> Dict:
        """
        Scenario D: Both endpoints on-network. Pure Valhalla routing.
        """
        t0 = time.time()
        costing = MODE_TO_COSTING.get(mode, "pedestrian")

        valhalla_request = {
            "locations": [
                {"lat": start_lat, "lon": start_lon},
                {"lat": end_lat, "lon": end_lon}
            ],
            "costing": costing,
            "directions_options": {"units": "kilometers"}
        }
        # MVUM Layer 2c: Valhalla wants array-of-rings, not GeoJSON Polygons.
        _ex = getattr(self, "_exclude_polygons", None)
        if _ex:
            valhalla_request["exclude_polygons"] = [p["coordinates"][0] for p in _ex]

        try:
            resp = requests.post(f"{VALHALLA_URL}/route", json=valhalla_request, timeout=30)

            if resp.status_code != 200:
                return {
                    "status": "error",
                    "message": f"Network routing failed: {resp.text[:200]}"
                }

            valhalla_data = resp.json()
            trip = valhalla_data.get("trip", {})
            legs = trip.get("legs", [])

            if not legs:
                return {"status": "error", "message": "No route found"}

            leg = legs[0]
            shape = leg.get("shape", "")
            network_coords = self._decode_polyline(shape)

            maneuvers = []
            for m in leg.get("maneuvers", []):
                maneuvers.append({
                    "instruction": m.get("instruction", ""),
                    "type": m.get("type", 0),
                    "distance_km": m.get("length", 0),
                    "time_seconds": m.get("time", 0),
                    "street_names": m.get("street_names", []),
                })

            summary = trip.get("summary", {})
            distance_km = summary.get("length", 0)
            duration_min = summary.get("time", 0) / 60

            # Build response in same format as wilderness routes
            network_feature = {
                "type": "Feature",
                "properties": {
                    "segment_type": "network",
                    "distance_km": distance_km,
                    "duration_minutes": duration_min,
                    "maneuvers": maneuvers,
                    "network_mode": mode,
                },
                "geometry": {"type": "LineString", "coordinates": network_coords}
            }

            combined_feature = {
                "type": "Feature",
                "properties": {
                    "segment_type": "combined",
                    "network_mode": mode,
                },
                "geometry": {"type": "LineString", "coordinates": network_coords}
            }

            geojson = {"type": "FeatureCollection", "features": [network_feature, combined_feature]}

            result = {
                "status": "ok",
                "route": geojson,
                "summary": {
                    "total_distance_km": float(distance_km),
                    "total_effort_minutes": float(duration_min),
                    "wilderness_distance_km": 0.0,
                    "wilderness_effort_minutes": 0.0,
                    "network_distance_km": float(distance_km),
                    "network_duration_minutes": float(duration_min),
                    "wilderness_minutes": 0.0,
                    "network_minutes": float(duration_min),
                    "on_trail_pct": 100.0,
                    "barrier_crossings": 0,
                    "network_mode": mode,
                    "scenario": "D",
                    "computation_time_s": time.time() - t0,
                }
            }
            return result

        except Exception as e:
            return {"status": "error", "message": f"Network routing failed: {e}"}

    def _route_A_wilderness_to_network(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        mode: str, boundary_mode: str
    ) -> Dict:
        """
        Scenario A: Off-network start → on-network end.
        Wilderness pathfinding from start to entry point, then Valhalla to end.
        """
        t0 = time.time()

        # Ensure entry point index exists
        if not self.entry_index.has_entry_points():
            return {
                "status": "error",
                "message": "Trail entry point index not built. Run build_entry_index() first."
            }

        # Get valid highway classes for this mode
        valid_highways = MODE_TO_VALID_HIGHWAYS.get(mode)

        # Find entry points near start, filtered by mode
        MAX_ENTRY_POINTS = 5  # tighter wilderness bbox: origin + 5 nearest entry points
        entry_points = self.entry_index.query_radius(
            start_lat, start_lon, DEFAULT_SEARCH_RADIUS_KM, valid_highways
        )

        if not entry_points:
            entry_points = self.entry_index.query_radius(
                start_lat, start_lon, EXPANDED_SEARCH_RADIUS_KM, valid_highways
            )
            if not entry_points:
                if mode == "vehicle":
                    msg = f"No roads found within {EXPANDED_SEARCH_RADIUS_KM}km. Try a different mode."
                elif mode in ("2w", "4w"):
                    msg = f"No tracks or roads found within {EXPANDED_SEARCH_RADIUS_KM}km. Try foot mode."
                else:
                    msg = f"No trail entry points found within {EXPANDED_SEARCH_RADIUS_KM}km of start."
                return {"status": "error", "message": msg}

        entry_points = entry_points[:MAX_ENTRY_POINTS]

        # Run wilderness pathfinding
        wilderness_result = self._pathfind_wilderness(
            start_lat, start_lon, end_lat, end_lon,
            entry_points, boundary_mode, "start", mode=mode
        )

        if wilderness_result.get("status") == "error":
            return wilderness_result

        # Extract results
        wilderness_coords = wilderness_result["coords"]
        wilderness_stats = wilderness_result["stats"]
        wilderness_elevations = wilderness_result.get("elevations", [])
        best_entry = wilderness_result["entry_point"]

        entry_lat = best_entry["lat"]
        entry_lon = best_entry["lon"]

        # Call Valhalla from entry point to destination
        network_result = self._valhalla_route(entry_lat, entry_lon, end_lat, end_lon, mode)

        # Build response
        return self._build_response(
            wilderness_start=wilderness_coords,
            wilderness_start_stats=wilderness_stats,
            wilderness_start_elevations=wilderness_elevations,
            network_segment=network_result.get("segment"),
            wilderness_end=None,
            wilderness_end_stats=None,
            wilderness_end_elevations=None,
            mode=mode,
            boundary_mode=boundary_mode,
            entry_start=best_entry,
            entry_end=None,
            scenario="A",
            t0=t0,
            valhalla_error=network_result.get("error")
        )

    def _route_C_network_to_wilderness(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        mode: str, boundary_mode: str
    ) -> Dict:
        """
        Scenario C: On-network start → off-network end.
        Valhalla from start to entry point, then wilderness pathfinding to end.
        """
        t0 = time.time()

        if not self.entry_index.has_entry_points():
            return {
                "status": "error",
                "message": "Trail entry point index not built. Run build_entry_index() first."
            }

        valid_highways = MODE_TO_VALID_HIGHWAYS.get(mode)

        # Find entry points near END (destination)
        MAX_ENTRY_POINTS = 5  # tighter wilderness bbox: origin + 5 nearest entry points
        entry_points = self.entry_index.query_radius(
            end_lat, end_lon, DEFAULT_SEARCH_RADIUS_KM, valid_highways
        )

        if not entry_points:
            entry_points = self.entry_index.query_radius(
                end_lat, end_lon, EXPANDED_SEARCH_RADIUS_KM, valid_highways
            )
            if not entry_points:
                if mode == "vehicle":
                    msg = f"No roads found within {EXPANDED_SEARCH_RADIUS_KM}km of destination. Try a different mode."
                elif mode in ("2w", "4w"):
                    msg = f"No tracks or roads found within {EXPANDED_SEARCH_RADIUS_KM}km of destination. Try foot mode."
                else:
                    msg = f"No trail entry points found within {EXPANDED_SEARCH_RADIUS_KM}km of destination."
                return {"status": "error", "message": msg}

        entry_points = entry_points[:MAX_ENTRY_POINTS]

        # Run wilderness pathfinding FROM END toward entry points
        wilderness_result = self._pathfind_wilderness(
            end_lat, end_lon, start_lat, start_lon,
            entry_points, boundary_mode, "end", mode=mode
        )

        if wilderness_result.get("status") == "error":
            return wilderness_result

        # The path is from end→entry, reverse it for display (entry→end)
        wilderness_coords = list(reversed(wilderness_result["coords"]))
        wilderness_stats = wilderness_result["stats"]
        wilderness_elevations = list(reversed(wilderness_result.get("elevations", [])))
        best_entry = wilderness_result["entry_point"]

        entry_lat = best_entry["lat"]
        entry_lon = best_entry["lon"]

        # Call Valhalla from start to entry point
        network_result = self._valhalla_route(start_lat, start_lon, entry_lat, entry_lon, mode)

        # Build response (network first, then wilderness)
        return self._build_response(
            wilderness_start=None,
            wilderness_start_stats=None,
            wilderness_start_elevations=None,
            network_segment=network_result.get("segment"),
            wilderness_end=wilderness_coords,
            wilderness_end_stats=wilderness_stats,
            wilderness_end_elevations=wilderness_elevations,
            mode=mode,
            boundary_mode=boundary_mode,
            entry_start=None,
            entry_end=best_entry,
            scenario="C",
            t0=t0,
            valhalla_error=network_result.get("error")
        )

    def _route_B_wilderness_both(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        mode: str, boundary_mode: str
    ) -> Dict:
        """
        Scenario B: Off-network start → off-network end.
        Wilderness from start to entry_A, Valhalla entry_A to entry_B, wilderness from entry_B to end.
        """
        t0 = time.time()

        if not self.entry_index.has_entry_points():
            return {
                "status": "error",
                "message": "Trail entry point index not built. Run build_entry_index() first."
            }

        valid_highways = MODE_TO_VALID_HIGHWAYS.get(mode)
        MAX_ENTRY_POINTS = 5  # tighter wilderness bbox: origin + 5 nearest entry points

        # Find entry points near START
        entry_points_start = self.entry_index.query_radius(
            start_lat, start_lon, DEFAULT_SEARCH_RADIUS_KM, valid_highways
        )
        if not entry_points_start:
            entry_points_start = self.entry_index.query_radius(
                start_lat, start_lon, EXPANDED_SEARCH_RADIUS_KM, valid_highways
            )
        if not entry_points_start:
            return {"status": "error", "message": f"No entry points found near start within {EXPANDED_SEARCH_RADIUS_KM}km."}
        entry_points_start = entry_points_start[:MAX_ENTRY_POINTS]

        # Find entry points near END
        entry_points_end = self.entry_index.query_radius(
            end_lat, end_lon, DEFAULT_SEARCH_RADIUS_KM, valid_highways
        )
        if not entry_points_end:
            entry_points_end = self.entry_index.query_radius(
                end_lat, end_lon, EXPANDED_SEARCH_RADIUS_KM, valid_highways
            )
        if not entry_points_end:
            return {"status": "error", "message": f"No entry points found near destination within {EXPANDED_SEARCH_RADIUS_KM}km."}
        entry_points_end = entry_points_end[:MAX_ENTRY_POINTS]

        # Phase 1: Wilderness pathfinding from START
        wilderness_start_result = self._pathfind_wilderness(
            start_lat, start_lon, end_lat, end_lon,
            entry_points_start, boundary_mode, "start", mode=mode
        )

        if wilderness_start_result.get("status") == "error":
            return wilderness_start_result

        wilderness_start_coords = wilderness_start_result["coords"]
        wilderness_start_stats = wilderness_start_result["stats"]
        wilderness_start_elevations = wilderness_start_result.get("elevations", [])
        entry_A = wilderness_start_result["entry_point"]

        # Phase 2: Wilderness pathfinding from END (run after freeing phase 1 memory)
        wilderness_end_result = self._pathfind_wilderness(
            end_lat, end_lon, start_lat, start_lon,
            entry_points_end, boundary_mode, "end", mode=mode
        )

        if wilderness_end_result.get("status") == "error":
            return wilderness_end_result

        # Reverse the end wilderness path (it's end→entry, we want entry→end for display)
        wilderness_end_coords = list(reversed(wilderness_end_result["coords"]))
        wilderness_end_stats = wilderness_end_result["stats"]
        wilderness_end_elevations = list(reversed(wilderness_end_result.get("elevations", [])))
        entry_B = wilderness_end_result["entry_point"]

        # Phase 3: Valhalla from entry_A to entry_B
        network_result = self._valhalla_route(
            entry_A["lat"], entry_A["lon"],
            entry_B["lat"], entry_B["lon"],
            mode
        )

        # Build response
        return self._build_response(
            wilderness_start=wilderness_start_coords,
            wilderness_start_stats=wilderness_start_stats,
            wilderness_start_elevations=wilderness_start_elevations,
            network_segment=network_result.get("segment"),
            wilderness_end=wilderness_end_coords,
            wilderness_end_stats=wilderness_end_stats,
            wilderness_end_elevations=wilderness_end_elevations,
            mode=mode,
            boundary_mode=boundary_mode,
            entry_start=entry_A,
            entry_end=entry_B,
            scenario="B",
            t0=t0,
            valhalla_error=network_result.get("error")
        )

    def _pathfind_wilderness(
        self,
        origin_lat: float, origin_lon: float,
        dest_lat: float, dest_lon: float,
        entry_points: List[Dict],
        boundary_mode: str,
        label: str,
        mode: str = "foot",
    ) -> Dict:
        """
        Run MCP wilderness pathfinding from origin toward entry points.

        Args:
            origin_lat, origin_lon: Starting point for pathfinding
            dest_lat, dest_lon: Ultimate destination (for bbox calculation)
            entry_points: List of candidate entry points
            boundary_mode: How to handle barriers
            label: "start" or "end" for error messages

        Returns:
            {"status": "ok", "coords": [...], "stats": {...}, "entry_point": {...}}
            or {"status": "error", "message": "..."}
        """
        # Build a tight bbox around origin + the (<=5) nearest entry points, NOT the distant
        # destination (Valhalla handles the network leg). A small pad keeps the pathfinder
        # off the grid edge; typical spans land ~3-5 km/side. MAX_BBOX_DEGREES is the
        # absolute safety clamp, unchanged.
        MAX_BBOX_DEGREES = 2.0
        all_lats = [origin_lat] + [p["lat"] for p in entry_points]
        all_lons = [origin_lon] + [p["lon"] for p in entry_points]

        padding = 0.015  # ~1.5 km
        bbox = {
            "south": min(all_lats) - padding,
            "north": max(all_lats) + padding,
            "west": min(all_lons) - padding,
            "east": max(all_lons) + padding,
        }

        # Clamp bbox size, centering on origin
        lat_span = bbox["north"] - bbox["south"]
        lon_span = bbox["east"] - bbox["west"]
        if lat_span > MAX_BBOX_DEGREES or lon_span > MAX_BBOX_DEGREES:
            half_span = MAX_BBOX_DEGREES / 2
            bbox = {
                "south": origin_lat - half_span,
                "north": origin_lat + half_span,
                "west": origin_lon - half_span,
                "east": origin_lon + half_span,
            }

        # Initialize readers
        self._init_readers()

        # Load elevation
        try:
            elevation, meta = self.dem_reader.get_elevation_grid(
                south=bbox["south"], north=bbox["north"],
                west=bbox["west"], east=bbox["east"],
            )
        except Exception as e:
            return {"status": "error", "message": f"Failed to load elevation for {label}: {e}"}

        # Check memory
        mem = check_memory_usage()
        if mem > MEMORY_LIMIT_GB:
            return {"status": "error", "message": f"Memory limit exceeded: {mem:.1f}GB > {MEMORY_LIMIT_GB}GB"}

        # Load friction
        friction_raw = self.friction_reader.get_friction_grid(
            south=bbox["south"], north=bbox["north"],
            west=bbox["west"], east=bbox["east"],
            target_shape=elevation.shape
        )
        friction_mult = friction_to_multiplier(friction_raw)

        # Load barriers
        barriers = self.barrier_reader.get_barrier_grid(
            south=bbox["south"], north=bbox["north"],
            west=bbox["west"], east=bbox["east"],
            target_shape=elevation.shape
        )

        # Load trails
        trails = self.trail_reader.get_trails_grid(
            south=bbox["south"], north=bbox["north"],
            west=bbox["west"], east=bbox["east"],
            target_shape=elevation.shape
        )

        # ── Anisotropic A* pathfinding (replaces isotropic MCP) ──
        # Wilderness pathfinding ALWAYS uses foot effort, regardless of the user's mode.
        # The off-trail cost math for MTB/ATV/vehicle is not well-grounded (no peer-reviewed
        # off-road model), and real-world wilderness traversal is foot anyway: you push the
        # bike and walk past where the vehicle stops. The user's mode still affects entry-point
        # eligibility (the highway filter at the query_radius call sites) and the Valhalla
        # network-leg costing -- just not this wilderness leg.
        _ = mode  # reserved for future flexibility; unused for wilderness cost
        cost_mode = "foot"
        profile = MODE_PROFILES[cost_mode]
        cell_size_m = meta["cell_size_m"]

        # Wilderness grid only matters for modes that treat it as impassable.
        wilderness = None
        if profile.wilderness_impassable and self.wilderness_reader is not None:
            wilderness = self.wilderness_reader.get_wilderness_grid(
                south=bbox["south"], north=bbox["north"],
                west=bbox["west"], east=bbox["east"],
                target_shape=elevation.shape,
            )

        # Per-cell context multiplier (slope-free; trails/barriers are per-edge in A*),
        # then exponentially inflated so hard cells bleed a decaying penalty outward.
        cost_mult = compute_cost_multiplier_grid(
            elevation,
            cell_size_lat_m=cell_size_m,
            cell_size_lon_m=cell_size_m,
            friction=friction_mult,
            friction_raw=friction_raw,
            wilderness=wilderness,
            mode=cost_mode,
        )
        cost_mult = inflate_cost_multiplier(cost_mult)

        # Free intermediate arrays
        del friction_mult, friction_raw
        gc.collect()

        # Trail friction lookup (length-256, indexed by trail value; inf = impassable).
        trail_friction_lookup = np.full(256, np.inf, dtype=np.float64)
        for tv, fric in profile.trail_friction.items():
            trail_friction_lookup[tv] = np.inf if fric is None else float(fric)

        speed_function_id = {"tobler": 0, "herzog": 1, "linear": 2}.get(profile.speed_function, 0)
        max_grade = float(np.tan(np.radians(profile.max_slope_deg)))

        # Convert origin to pixel coordinates
        origin_row, origin_col = self.dem_reader.latlon_to_pixel(origin_lat, origin_lon, meta)

        rows, cols = elevation.shape
        if not (0 <= origin_row < rows and 0 <= origin_col < cols):
            return {"status": "error", "message": f"{label.capitalize()} point outside grid bounds"}

        # Map entry points to pixels (these are the A* goals).
        entry_pixels = []
        for ep in entry_points:
            row, col = self.dem_reader.latlon_to_pixel(ep["lat"], ep["lon"], meta)
            if 0 <= row < rows and 0 <= col < cols:
                entry_pixels.append({"row": row, "col": col, "entry_point": ep})

        if not entry_pixels:
            return {"status": "error", "message": f"No entry points map to grid bounds for {label}"}

        goal_rows = np.array([ep["row"] for ep in entry_pixels], dtype=np.int64)
        goal_cols = np.array([ep["col"] for ep in entry_pixels], dtype=np.int64)
        boundary_mode_id = {"strict": 0, "pragmatic": 1, "emergency": 2}.get(boundary_mode, 1)

        # Run multi-goal A* (first goal popped wins).
        elevation = np.ascontiguousarray(elevation, dtype=np.float64)
        best_goal_idx, path_indices, best_cost = astar_multigoal(
            cost_mult, elevation,
            float(cell_size_m), float(cell_size_m),
            max_grade, speed_function_id, float(profile.base_speed_kmh),
            np.ascontiguousarray(trails, dtype=np.uint8), trail_friction_lookup,
            np.ascontiguousarray(barriers, dtype=np.uint8), boundary_mode_id,
            int(origin_row), int(origin_col),
            goal_rows, goal_cols,
        )

        if best_goal_idx < 0 or len(path_indices) == 0 or np.isinf(best_cost):
            return {
                "status": "error",
                "message": f"No path found from {label} to any entry point (blocked by impassable terrain)"
            }

        best_entry = entry_pixels[best_goal_idx]

        # Convert to coordinates and collect stats
        coords = []
        elevations = []
        trail_values = []
        barrier_crossings = 0

        for row, col in path_indices:
            lat, lon = self.dem_reader.pixel_to_latlon(row, col, meta)
            coords.append([lon, lat])
            elevations.append(elevation[row, col])
            trail_values.append(trails[row, col])
            if barriers[row, col] == 255:
                barrier_crossings += 1

        # Calculate distance
        distance_m = 0
        for i in range(1, len(coords)):
            lon1, lat1 = coords[i-1]
            lon2, lat2 = coords[i]
            distance_m += haversine_distance(lat1, lon1, lat2, lon2)

        # Elevation stats
        elev_arr = np.array(elevations)
        elev_diff = np.diff(elev_arr)
        elev_gain = float(np.sum(elev_diff[elev_diff > 0]))
        elev_loss = float(np.sum(np.abs(elev_diff[elev_diff < 0])))

        # Trail stats
        trail_arr = np.array(trail_values)
        on_trail_cells = np.sum(trail_arr > 0)
        total_cells = len(trail_arr)
        on_trail_pct = float(100 * on_trail_cells / total_cells) if total_cells > 0 else 0

        # Free memory
        del cost_mult, trails, barriers, elevation
        gc.collect()

        return {
            "status": "ok",
            "coords": coords,
            "elevations": elevations,  # Raw elevation values for maneuver generation
            "stats": {
                "distance_km": distance_m / 1000,
                "effort_minutes": best_cost / 60,
                "elevation_gain_m": elev_gain,
                "elevation_loss_m": elev_loss,
                "on_trail_pct": on_trail_pct,
                "barrier_crossings": barrier_crossings,
                "cell_count": total_cells,
            },
            "entry_point": best_entry["entry_point"]
        }

    def _valhalla_route(
        self,
        start_lat: float, start_lon: float,
        end_lat: float, end_lon: float,
        mode: str
    ) -> Dict:
        """
        Call Valhalla for network routing.

        Returns:
            {"segment": {...}, "error": None} on success
            {"segment": None, "error": "..."} on failure
        """
        costing = MODE_TO_COSTING.get(mode, "pedestrian")

        valhalla_request = {
            "locations": [
                {"lat": start_lat, "lon": start_lon},
                {"lat": end_lat, "lon": end_lon}
            ],
            "costing": costing,
            "directions_options": {"units": "kilometers"}
        }
        # MVUM Layer 2c: Valhalla wants array-of-rings, not GeoJSON Polygons.
        _ex = getattr(self, "_exclude_polygons", None)
        if _ex:
            valhalla_request["exclude_polygons"] = [p["coordinates"][0] for p in _ex]

        try:
            resp = requests.post(f"{VALHALLA_URL}/route", json=valhalla_request, timeout=30)

            if resp.status_code == 200:
                valhalla_data = resp.json()
                trip = valhalla_data.get("trip", {})
                legs = trip.get("legs", [])

                if legs:
                    leg = legs[0]
                    shape = leg.get("shape", "")
                    coords = self._decode_polyline(shape)

                    maneuvers = []
                    for m in leg.get("maneuvers", []):
                        maneuvers.append({
                            "instruction": m.get("instruction", ""),
                            "type": m.get("type", 0),
                            "distance_km": m.get("length", 0),
                            "time_seconds": m.get("time", 0),
                            "street_names": m.get("street_names", []),
                        })

                    summary = trip.get("summary", {})
                    return {
                        "segment": {
                            "coordinates": coords,
                            "distance_km": summary.get("length", 0),
                            "duration_minutes": summary.get("time", 0) / 60,
                            "maneuvers": maneuvers,
                        },
                        "error": None
                    }

            return {"segment": None, "error": f"Valhalla returned {resp.status_code}: {resp.text[:200]}"}

        except Exception as e:
            return {"segment": None, "error": f"Valhalla request failed: {e}"}

    def _generate_wilderness_maneuvers(
        self,
        coords: List[List[float]],
        elevations: List[float],
        position: str = "start"
    ) -> List[Dict]:
        """
        Generate turn-by-turn maneuvers for a wilderness segment.

        Segment breaks occur when:
        - Bearing changes more than 30° from segment start
        - Grade category changes (flat→steep etc)
        - Distance exceeds 0.5 miles without a break

        Args:
            coords: [[lon, lat], ...] coordinate list
            elevations: Elevation values (meters) for each coord
            position: "start" or "end" for labeling

        Returns:
            List of maneuver dicts with instruction, distance, elevation, grade, bearing
        """
        if not coords or len(coords) < 2:
            return []

        # Constants
        COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                   "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
        MAX_SEGMENT_M = 804.672  # 0.5 miles in meters
        BEARING_THRESHOLD = 30  # degrees
        M_TO_FT = 3.28084
        M_TO_MI = 0.000621371

        def get_bearing(lat1, lon1, lat2, lon2):
            """Calculate bearing between two points (degrees 0-360)."""
            dlon = math.radians(lon2 - lon1)
            lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
            x = math.sin(dlon) * math.cos(lat2_r)
            y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
            return (math.degrees(math.atan2(x, y)) + 360) % 360

        def bearing_to_cardinal(bearing):
            """Convert bearing to 16-point compass direction."""
            return COMPASS[round(bearing / 22.5) % 16]

        def get_grade_category(grade_deg):
            """Categorize grade angle: flat (0-2°), gentle (2-5°), moderate (5-10°), steep (10-15°), very steep (15°+)."""
            grade_abs = abs(grade_deg)
            if grade_abs < 2:
                return "flat"
            elif grade_abs < 5:
                return "gentle"
            elif grade_abs < 10:
                return "moderate"
            elif grade_abs < 15:
                return "steep"
            else:
                return "very steep"

        def format_distance(meters):
            """Format distance: feet with commas if under 1 mile, miles with one decimal if over."""
            miles = meters * M_TO_MI
            if miles < 1.0:
                feet = round(meters * M_TO_FT)
                return f"{feet:,} ft"
            else:
                return f"{miles:.1f} mi"

        def build_instruction(cardinal, gain_ft, loss_ft, grade_cat, distance_m):
            """Build instruction string per spec."""
            dist_str = format_distance(distance_m)
            if grade_cat == "flat":
                return f"Head {cardinal} on level ground — {dist_str}"
            elif gain_ft > loss_ft:
                return f"Head {cardinal}, gaining {gain_ft:,} ft ({grade_cat} uphill) — {dist_str}"
            else:
                return f"Head {cardinal}, descending {loss_ft:,} ft ({grade_cat} downhill) — {dist_str}"

        maneuvers = []
        i = 0

        while i < len(coords) - 1:
            seg_start_idx = i
            seg_start_lon, seg_start_lat = coords[i]
            seg_start_elev = elevations[i] if i < len(elevations) else 0

            # Initial bearing for this segment
            next_lon, next_lat = coords[i + 1]
            seg_bearing = get_bearing(seg_start_lat, seg_start_lon, next_lat, next_lon)

            # Accumulate elevation changes within segment
            seg_distance_m = 0
            seg_elev_gain = 0
            seg_elev_loss = 0
            prev_elev = seg_start_elev

            # Calculate initial grade category
            step_dist = haversine_distance(seg_start_lat, seg_start_lon, next_lat, next_lon)
            step_elev_change = (elevations[i + 1] if i + 1 < len(elevations) else seg_start_elev) - seg_start_elev
            initial_grade = math.degrees(math.atan(step_elev_change / step_dist)) if step_dist > 0 else 0
            seg_grade_cat = get_grade_category(initial_grade)

            j = i
            while j < len(coords) - 1:
                lon1, lat1 = coords[j]
                lon2, lat2 = coords[j + 1]
                elev1 = elevations[j] if j < len(elevations) else prev_elev
                elev2 = elevations[j + 1] if j + 1 < len(elevations) else elev1

                step_dist = haversine_distance(lat1, lon1, lat2, lon2)
                step_bearing = get_bearing(lat1, lon1, lat2, lon2)
                step_elev_change = elev2 - elev1
                step_grade = math.degrees(math.atan(step_elev_change / step_dist)) if step_dist > 0 else 0
                step_grade_cat = get_grade_category(step_grade)

                # Check break conditions
                bearing_diff = abs(step_bearing - seg_bearing)
                if bearing_diff > 180:
                    bearing_diff = 360 - bearing_diff

                # Break if: bearing changed >30°, grade category changed, or distance >0.5mi
                if seg_distance_m > 0:  # Don't break on first step
                    if bearing_diff > BEARING_THRESHOLD:
                        break
                    if step_grade_cat != seg_grade_cat:
                        break
                    if seg_distance_m >= MAX_SEGMENT_M:
                        break

                # Accumulate
                seg_distance_m += step_dist
                if step_elev_change > 0:
                    seg_elev_gain += step_elev_change
                else:
                    seg_elev_loss += abs(step_elev_change)
                prev_elev = elev2
                j += 1

            # Compute segment stats
            seg_end_idx = j
            gain_ft = round(seg_elev_gain * M_TO_FT)
            loss_ft = round(seg_elev_loss * M_TO_FT)

            # Net elevation change for grade calculation
            net_elev_change = seg_elev_gain - seg_elev_loss
            grade_deg = math.degrees(math.atan(net_elev_change / seg_distance_m)) if seg_distance_m > 0 else 0
            grade_cat = get_grade_category(grade_deg)

            cardinal = bearing_to_cardinal(seg_bearing)
            instruction = build_instruction(cardinal, gain_ft, loss_ft, grade_cat, seg_distance_m)

            maneuvers.append({
                "instruction": instruction,
                "type": "wilderness",
                "distance_m": round(seg_distance_m, 1),
                "elevation_gain_ft": gain_ft,
                "elevation_loss_ft": loss_ft,
                "grade_degrees": round(grade_deg, 1),
                "grade_category": grade_cat,
                "bearing": round(seg_bearing, 1),
                "cardinal": cardinal,
            })

            i = seg_end_idx

        # Add arrival maneuver
        arrival_text = "Arrive at trail/road" if position == "start" else "Arrive at destination"
        last_bearing = maneuvers[-1]["bearing"] if maneuvers else 0
        last_cardinal = maneuvers[-1]["cardinal"] if maneuvers else "N"

        maneuvers.append({
            "instruction": arrival_text,
            "type": "arrival",
            "distance_m": 0,
            "elevation_gain_ft": 0,
            "elevation_loss_ft": 0,
            "grade_degrees": 0,
            "grade_category": "flat",
            "bearing": last_bearing,
            "cardinal": last_cardinal,
        })

        return maneuvers

    def _build_response(
        self,
        wilderness_start: Optional[List],
        wilderness_start_stats: Optional[Dict],
        wilderness_start_elevations: Optional[List],
        network_segment: Optional[Dict],
        wilderness_end: Optional[List],
        wilderness_end_stats: Optional[Dict],
        wilderness_end_elevations: Optional[List],
        mode: str,
        boundary_mode: str,
        entry_start: Optional[Dict],
        entry_end: Optional[Dict],
        scenario: str,
        t0: float,
        valhalla_error: Optional[str]
    ) -> Dict:
        """Build the final GeoJSON response."""
        features = []

        # Wilderness start segment
        if wilderness_start and wilderness_start_stats:
            wild_start_maneuvers = []
            if wilderness_start_elevations:
                wild_start_maneuvers = self._generate_wilderness_maneuvers(
                    wilderness_start, wilderness_start_elevations, position="start"
                )
            features.append({
                "type": "Feature",
                "properties": {
                    "segment_type": "wilderness",
                    "segment_position": "start",
                    "effort_minutes": float(wilderness_start_stats["effort_minutes"]),
                    "distance_km": float(wilderness_start_stats["distance_km"]),
                    "elevation_gain_m": wilderness_start_stats["elevation_gain_m"],
                    "elevation_loss_m": wilderness_start_stats["elevation_loss_m"],
                    "boundary_mode": boundary_mode,
                    "on_trail_pct": wilderness_start_stats["on_trail_pct"],
                    "barrier_crossings": wilderness_start_stats["barrier_crossings"],
                    "wilderness_mode": "foot",
                    "maneuvers": wild_start_maneuvers,
                },
                "geometry": {"type": "LineString", "coordinates": wilderness_start}
            })

        # Network segment
        if network_segment:
            features.append({
                "type": "Feature",
                "properties": {
                    "segment_type": "network",
                    "distance_km": network_segment["distance_km"],
                    "duration_minutes": network_segment["duration_minutes"],
                    "maneuvers": network_segment["maneuvers"],
                    "network_mode": mode,
                },
                "geometry": {"type": "LineString", "coordinates": network_segment["coordinates"]}
            })

        # Wilderness end segment
        if wilderness_end and wilderness_end_stats:
            wild_end_maneuvers = []
            if wilderness_end_elevations:
                wild_end_maneuvers = self._generate_wilderness_maneuvers(
                    wilderness_end, wilderness_end_elevations, position="end"
                )
            features.append({
                "type": "Feature",
                "properties": {
                    "segment_type": "wilderness",
                    "segment_position": "end",
                    "effort_minutes": float(wilderness_end_stats["effort_minutes"]),
                    "distance_km": float(wilderness_end_stats["distance_km"]),
                    "elevation_gain_m": wilderness_end_stats["elevation_gain_m"],
                    "elevation_loss_m": wilderness_end_stats["elevation_loss_m"],
                    "boundary_mode": boundary_mode,
                    "on_trail_pct": wilderness_end_stats["on_trail_pct"],
                    "barrier_crossings": wilderness_end_stats["barrier_crossings"],
                    "wilderness_mode": "foot",
                    "maneuvers": wild_end_maneuvers,
                },
                "geometry": {"type": "LineString", "coordinates": wilderness_end}
            })

        # Combined path
        combined_coords = []
        if wilderness_start:
            combined_coords.extend(wilderness_start)
        if network_segment:
            # Skip first coord if we already have wilderness_start (avoid duplicate)
            start_idx = 1 if wilderness_start else 0
            combined_coords.extend(network_segment["coordinates"][start_idx:])
        if wilderness_end:
            # Skip first coord (avoid duplicate with network end)
            start_idx = 1 if (wilderness_start or network_segment) else 0
            combined_coords.extend(wilderness_end[start_idx:])

        if combined_coords:
            features.append({
                "type": "Feature",
                "properties": {
                    "segment_type": "combined",
                    "wilderness_mode": "foot",
                    "network_mode": mode,
                    "boundary_mode": boundary_mode,
                    "scenario": scenario,
                },
                "geometry": {"type": "LineString", "coordinates": combined_coords}
            })

        geojson = {"type": "FeatureCollection", "features": features}

        # Calculate totals
        total_distance_km = 0.0
        total_effort_minutes = 0.0
        wilderness_distance_km = 0.0
        wilderness_effort_minutes = 0.0
        network_distance_km = 0.0
        network_duration_minutes = 0.0
        barrier_crossings = 0
        on_trail_pct = 0.0

        if wilderness_start_stats:
            wilderness_distance_km += wilderness_start_stats["distance_km"]
            wilderness_effort_minutes += wilderness_start_stats["effort_minutes"]
            barrier_crossings += wilderness_start_stats["barrier_crossings"]
            on_trail_pct = wilderness_start_stats["on_trail_pct"]

        if wilderness_end_stats:
            wilderness_distance_km += wilderness_end_stats["distance_km"]
            wilderness_effort_minutes += wilderness_end_stats["effort_minutes"]
            barrier_crossings += wilderness_end_stats["barrier_crossings"]
            # Average on-trail percentage if we have both
            if wilderness_start_stats:
                on_trail_pct = (on_trail_pct + wilderness_end_stats["on_trail_pct"]) / 2
            else:
                on_trail_pct = wilderness_end_stats["on_trail_pct"]

        if network_segment:
            network_distance_km = network_segment["distance_km"]
            network_duration_minutes = network_segment["duration_minutes"]

        total_distance_km = wilderness_distance_km + network_distance_km
        total_effort_minutes = wilderness_effort_minutes + network_duration_minutes

        summary = {
            "total_distance_km": float(total_distance_km),
            "total_effort_minutes": float(total_effort_minutes),
            "wilderness_distance_km": float(wilderness_distance_km),
            "wilderness_effort_minutes": float(wilderness_effort_minutes),
            "network_distance_km": float(network_distance_km),
            "network_duration_minutes": float(network_duration_minutes),
            "wilderness_minutes": float(wilderness_effort_minutes),
            "network_minutes": float(network_duration_minutes),
            "on_trail_pct": float(on_trail_pct),
            "barrier_crossings": barrier_crossings,
            "boundary_mode": boundary_mode,
            "wilderness_mode": "foot",
            "network_mode": mode,
            "scenario": scenario,
            "computation_time_s": time.time() - t0,
        }

        if entry_start:
            summary["entry_point_start"] = {
                "lat": entry_start["lat"],
                "lon": entry_start["lon"],
                "highway_class": entry_start["highway_class"],
                "name": entry_start.get("name", ""),
            }

        if entry_end:
            summary["entry_point_end"] = {
                "lat": entry_end["lat"],
                "lon": entry_end["lon"],
                "highway_class": entry_end["highway_class"],
                "name": entry_end.get("name", ""),
            }

        result = {"status": "ok", "route": geojson, "summary": summary}

        if valhalla_error:
            result["warning"] = f"Network segment incomplete: {valhalla_error}"

        return result

    def _decode_polyline(self, encoded: str, precision: int = 6) -> List[List[float]]:
        """Decode a polyline string into coordinates [lon, lat]."""
        coords = []
        index = 0
        lat = 0
        lon = 0

        while index < len(encoded):
            shift = 0
            result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlat = ~(result >> 1) if result & 1 else result >> 1
            lat += dlat

            shift = 0
            result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            dlon = ~(result >> 1) if result & 1 else result >> 1
            lon += dlon

            coords.append([lon / (10 ** precision), lat / (10 ** precision)])

        return coords

    def close(self):
        """Close all readers."""
        if self.dem_reader:
            self.dem_reader.close()
        if self.friction_reader:
            self.friction_reader.close()
        if self.barrier_reader:
            self.barrier_reader.close()
        if self.wilderness_reader:
            self.wilderness_reader.close()
        if self.trail_reader:
            self.trail_reader.close()
        self.entry_index.close()


def build_entry_index():
    """Build the trail entry point index."""
    index = EntryPointIndex()
    stats = index.build_index()
    index.close()
    return stats


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "build":
        print("Building trail entry point index...")
        stats = build_entry_index()
        print(f"\nDone. Total entry points: {stats['total']}")

    elif len(sys.argv) > 1 and sys.argv[1] == "test":
        print("Testing router (all scenarios)...")
        print("=" * 60)

        router = OffrouteRouter()

        # Test points
        wilderness_start = (44.0543, -115.4237)  # Off-network
        wilderness_end = (45.2, -115.5)          # Deep wilderness (Frank Church)
        road_start = (43.6150, -116.2023)        # Boise downtown (on-network)
        road_end = (43.5867, -116.5625)          # Nampa (on-network)

        tests = [
            ("A: wilderness→road", wilderness_start, (44.0814, -115.5021)),
            ("B: wilderness→wilderness", wilderness_start, wilderness_end),
            ("C: road→wilderness", road_start, wilderness_start),
            ("D: road→road", road_start, road_end),
        ]

        for label, (slat, slon), (elat, elon) in tests:
            print(f"\n{label}")
            print("-" * 40)

            result = router.route(
                start_lat=slat, start_lon=slon,
                end_lat=elat, end_lon=elon,
                mode="foot", boundary_mode="pragmatic"
            )

            if result["status"] == "ok":
                s = result["summary"]
                print(f"  Scenario: {s.get('scenario', '?')}")
                print(f"  Total: {s['total_distance_km']:.2f} km, {s['total_effort_minutes']:.1f} min")
                print(f"  Wilderness: {s['wilderness_distance_km']:.2f} km")
                print(f"  Network: {s['network_distance_km']:.2f} km")
                if s.get('entry_point_start'):
                    ep = s['entry_point_start']
                    print(f"  Entry (start): {ep['highway_class']} at {ep['lat']:.4f}, {ep['lon']:.4f}")
                if s.get('entry_point_end'):
                    ep = s['entry_point_end']
                    print(f"  Entry (end): {ep['highway_class']} at {ep['lat']:.4f}, {ep['lon']:.4f}")
            else:
                print(f"  ERROR: {result['message']}")

        router.close()

    else:
        print("Usage:")
        print("  python router.py build   # Build entry point index")
        print("  python router.py test    # Test all scenarios")
