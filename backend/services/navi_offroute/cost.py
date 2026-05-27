"""
Multi-mode travel cost functions for OFFROUTE.

Supports four travel modes: foot, 2w, 4w, vehicle.
Each mode has its own speed function, max slope, trail access rules,
and terrain friction overrides.

Mode profiles are data-driven — adding a new mode means adding a profile entry.
"""
import math
import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Literal, Dict, Callable

# ═══════════════════════════════════════════════════════════════════════════════
# SPEED FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def tobler_off_path_speed(grade: np.ndarray, base_speed: float = 6.0) -> np.ndarray:
    """
    Tobler off-path hiking function.

    W = 0.6 * base_speed * exp(-3.5 * |S + 0.05|)

    Peak ~3.6 km/h at grade = -0.05 (slight downhill).
    The 0.6 multiplier is the off-trail penalty.
    """
    return 0.6 * base_speed * np.exp(-3.5 * np.abs(grade + 0.05))


def herzog_wheeled_speed(grade: np.ndarray, base_speed: float = 12.0) -> np.ndarray:
    """
    Herzog wheeled-transport polynomial.

    Relative speed factor:
    1 / (1337.8·S^6 + 278.19·S^5 − 517.39·S^4 − 78.199·S^3 + 93.419·S^2 + 19.825·|S| + 1.64)

    Multiply by base_speed to get km/h.
    """
    S = grade
    S_abs = np.abs(S)

    # Herzog polynomial (returns relative speed factor 0-1)
    denom = (1337.8 * S**6 + 278.19 * S**5 - 517.39 * S**4
             - 78.199 * S**3 + 93.419 * S**2 + 19.825 * S_abs + 1.64)

    # Avoid division by zero and negative speeds
    denom = np.maximum(denom, 0.1)
    rel_speed = 1.0 / denom

    # Clamp relative speed to reasonable bounds (0.05 to 1.5)
    rel_speed = np.clip(rel_speed, 0.05, 1.5)

    return base_speed * rel_speed


def linear_degrade_speed(grade: np.ndarray, base_speed: float = 40.0, max_grade: float = 0.364) -> np.ndarray:
    """
    Linear speed degradation with slope.

    speed = base_speed * max(0, 1 - |grade| / max_grade)

    max_grade = tan(20°) ≈ 0.364 for 20° max slope.
    """
    speed = base_speed * np.maximum(0, 1.0 - np.abs(grade) / max_grade)
    return np.maximum(speed, 0.1)  # Minimum crawl speed


# ═══════════════════════════════════════════════════════════════════════════════
# MODE PROFILES (Data-driven configuration)
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ModeProfile:
    """Configuration for a travel mode."""

    name: str
    description: str

    # Speed function parameters
    speed_function: str  # "tobler", "herzog", "linear"
    base_speed_kmh: float
    max_slope_deg: float

    # Trail access: trail_value -> friction multiplier (None = impassable)
    # Trail values: 5=road, 15=track, 25=foot trail
    trail_friction: Dict[int, Optional[float]] = field(default_factory=dict)

    # Off-trail terrain friction overrides (by WorldCover class)
    # These MULTIPLY the base WorldCover friction
    # None = use default, np.inf = impassable
    # WorldCover values: 10=tree, 20=shrub, 30=grass, 40=crop, 50=urban,
    #                    60=bare, 80=water, 90=wetland, 95=mangrove, 100=moss
    terrain_friction_override: Dict[int, Optional[float]] = field(default_factory=dict)

    # Should wilderness areas be impassable?
    wilderness_impassable: bool = False

    # For vehicle mode: can traverse off-trail flat terrain?
    off_trail_flat_threshold_deg: float = 0.0  # 0 = no off-trail allowed
    off_trail_flat_friction: float = np.inf  # friction if allowed


# Define all mode profiles
MODE_PROFILES: Dict[str, ModeProfile] = {
    "foot": ModeProfile(
        name="foot",
        description="Hiking on foot (Tobler off-path model)",
        speed_function="tobler",
        base_speed_kmh=6.0,
        max_slope_deg=40.0,
        trail_friction={
            5: 0.1,   # road
            15: 0.3,  # track
            25: 0.5,  # foot trail
        },
        terrain_friction_override={
            # Use default WorldCover friction for foot mode
        },
        wilderness_impassable=False,
    ),

    "2w": ModeProfile(
        name="2w",
        description="Mountain bike / dirt bike (Herzog wheeled model)",
        speed_function="herzog",
        base_speed_kmh=12.0,
        max_slope_deg=25.0,
        trail_friction={
            5: 0.1,   # road
            15: 0.2,  # track
            25: 0.5,  # foot trail (rideable but slow)
        },
        terrain_friction_override={
            30: 2.0,   # Grassland: rideable but slow
            20: 4.0,   # Shrubland: barely rideable
            10: 8.0,   # Tree cover/forest: effectively impassable
            60: 3.0,   # Bare/rocky
            90: np.inf,  # Wetland: impassable
            95: np.inf,  # Mangrove: impassable
            80: np.inf,  # Water: impassable
        },
        wilderness_impassable=True,
    ),

    "4w": ModeProfile(
        name="4w",
        description="ATV / side-by-side (Herzog wheeled model, higher base speed)",
        speed_function="herzog",
        base_speed_kmh=25.0,
        max_slope_deg=30.0,
        trail_friction={
            5: 0.1,    # road
            15: 0.3,   # track
            25: None,  # foot trail: impassable (too narrow)
        },
        terrain_friction_override={
            30: 1.5,   # Grassland: passable
            20: 3.0,   # Shrubland: rough
            10: np.inf,  # Forest: impassable
            60: 2.0,   # Bare/rocky
            90: np.inf,  # Wetland: impassable
            95: np.inf,  # Mangrove: impassable
            80: np.inf,  # Water: impassable
        },
        wilderness_impassable=True,
    ),

    "vehicle": ModeProfile(
        name="vehicle",
        description="4x4 truck / jeep (linear speed degradation)",
        speed_function="linear",
        base_speed_kmh=40.0,
        max_slope_deg=20.0,
        trail_friction={
            5: 0.1,    # road
            15: 0.5,   # track (rough but passable)
            25: None,  # foot trail: impassable
        },
        terrain_friction_override={
            # All off-trail terrain is impassable by default
            10: np.inf,  # Forest
            20: np.inf,  # Shrubland
            30: np.inf,  # Grassland (except flat - see below)
            40: np.inf,  # Cropland (except flat - see below)
            60: np.inf,  # Bare
            90: np.inf,  # Wetland
            95: np.inf,  # Mangrove
            80: np.inf,  # Water
        },
        wilderness_impassable=True,
        off_trail_flat_threshold_deg=5.0,  # Can drive on flat fields
        off_trail_flat_friction=5.0,       # But very slow
    ),
}


# Pragmatic mode friction multiplier for private land
PRAGMATIC_BARRIER_MULTIPLIER = 5.0

# Mode-switch transition penalties (seconds), unified-graph Auto (spec §4; used by transitions.py).
TRANSITION_COST_PARKING_S        = 60.0   # park & switch at a lot
TRANSITION_COST_TRAILHEAD_S      = 30.0   # stage at a trailhead
TRANSITION_COST_ROAD_TERMINUS_S  = 60.0   # leave/meet vehicle at road end
TRANSITION_COST_SURFACE_CHANGE_S = 0.0    # surface boundary, free swap


# ═══════════════════════════════════════════════════════════════════════════════
# COST GRID COMPUTATION
# ═══════════════════════════════════════════════════════════════════════════════

def _per_cell_grade(elevation, cell_size_lat_m, cell_size_lon_m):
    """Per-cell slope magnitude (rise/run), matching compute_cost_grid's gradient.
    Used only to classify the vehicle off-trail flat-field special case."""
    grade = np.zeros(elevation.shape, dtype=np.float32)
    dy = np.zeros(elevation.shape, dtype=np.float32)
    dy[1:-1, :] = ((elevation[:-2, :] - elevation[2:, :]) / (2 * cell_size_lat_m)) ** 2
    dy[0, :] = ((elevation[0, :] - elevation[1, :]) / cell_size_lat_m) ** 2
    dy[-1, :] = ((elevation[-2, :] - elevation[-1, :]) / cell_size_lat_m) ** 2
    dy[:, 1:-1] += ((elevation[:, 2:] - elevation[:, :-2]) / (2 * cell_size_lon_m)) ** 2
    dy[:, 0] += ((elevation[:, 1] - elevation[:, 0]) / cell_size_lon_m) ** 2
    dy[:, -1] += ((elevation[:, -1] - elevation[:, -2]) / cell_size_lon_m) ** 2
    np.sqrt(dy, out=grade)
    return grade


def compute_cost_multiplier_grid(
    elevation: np.ndarray,
    cell_size_lat_m: float,
    cell_size_lon_m: float,
    friction: Optional[np.ndarray] = None,
    friction_raw: Optional[np.ndarray] = None,
    wilderness: Optional[np.ndarray] = None,
    mode: Literal["foot", "2w", "4w", "vehicle"] = "foot",
) -> np.ndarray:
    """Per-cell SLOPE-FREE context cost multiplier for the anisotropic A* pathfinder.

    Returns a float64 grid: 1.0 baseline, higher = harder, np.inf = impassable. It
    combines the base WorldCover friction, the mode's terrain-friction overrides, the
    vehicle off-trail flat-field special case, and wilderness impassability. Slope,
    trails, and barriers are handled PER-EDGE in the A* kernel and are NOT applied here.

    This is a strict refactor of compute_cost_grid's friction-and-mode pieces.
    (elevation + cell sizes are needed only for the vehicle flat-field slope check —
    that classification is per-cell, distinct from the per-edge traversal slope.)
    """
    if mode not in MODE_PROFILES:
        raise ValueError(f"mode must be one of {list(MODE_PROFILES.keys())}")
    profile = MODE_PROFILES[mode]

    mult = np.ones(elevation.shape, dtype=np.float64)

    # Base WorldCover friction.
    if friction is not None:
        if friction.shape != elevation.shape:
            raise ValueError("Friction shape mismatch")
        np.multiply(mult, friction, out=mult)

    # NaN elevation -> impassable.
    mult[np.isnan(elevation)] = np.inf

    # Mode-specific terrain friction overrides.
    if friction_raw is not None and profile.terrain_friction_override:
        if friction_raw.shape != elevation.shape:
            raise ValueError("Friction_raw shape mismatch")
        for wc_class, override in profile.terrain_friction_override.items():
            if override is None:
                continue
            if override == np.inf:
                np.putmask(mult, friction_raw == wc_class, np.inf)
            else:
                m = friction_raw == wc_class
                mult[m] *= override
                del m

    # Vehicle off-trail flat-field special case (overrides the inf set above on flat
    # grassland/cropland). Uses a per-cell slope classification.
    if mode == "vehicle" and profile.off_trail_flat_threshold_deg > 0 and friction_raw is not None:
        grade = _per_cell_grade(elevation, cell_size_lat_m, cell_size_lon_m)
        slope_deg = np.degrees(np.arctan(grade))
        flat_field = (
            (slope_deg <= profile.off_trail_flat_threshold_deg)
            & ((friction_raw == 30) | (friction_raw == 40))
        )
        mult[flat_field] = profile.off_trail_flat_friction
        del grade, slope_deg, flat_field

    # Wilderness areas (mode-specific).
    if wilderness is not None and profile.wilderness_impassable:
        if wilderness.shape != elevation.shape:
            raise ValueError("Wilderness shape mismatch")
        np.putmask(mult, wilderness == 255, np.inf)

    return mult


def compute_cost_grid(
    elevation: np.ndarray,
    cell_size_m: float,
    cell_size_lat_m: float = None,
    cell_size_lon_m: float = None,
    friction: Optional[np.ndarray] = None,
    friction_raw: Optional[np.ndarray] = None,
    trails: Optional[np.ndarray] = None,
    barriers: Optional[np.ndarray] = None,
    wilderness: Optional[np.ndarray] = None,
    mvum: Optional[np.ndarray] = None,
    boundary_mode: Literal["strict", "pragmatic", "emergency"] = "pragmatic",
    mode: Literal["foot", "2w", "4w", "vehicle"] = "foot"
) -> np.ndarray:
    """
    Compute isotropic travel cost grid from elevation data.

    Args:
        elevation: 2D array of elevation values in meters
        cell_size_m: Average cell size in meters
        cell_size_lat_m: Cell size in latitude direction (optional)
        cell_size_lon_m: Cell size in longitude direction (optional)
        friction: Optional 2D array of friction multipliers (WorldCover).
                  Values should be float (1.0 = baseline, 2.0 = 2x slower).
                  np.inf marks impassable cells.
        friction_raw: Optional 2D array of raw WorldCover class values (uint8).
                  Used for mode-specific terrain overrides.
                  Values: 10=tree, 20=shrub, 30=grass, etc.
        trails: Optional 2D array of trail values (uint8).
                  0 = no trail, 5 = road, 15 = track, 25 = foot trail
        barriers: Optional 2D array of barrier values (uint8).
                  255 = closed/restricted area (PAD-US Pub_Access = XA).
        wilderness: Optional[np.ndarray] of wilderness values (uint8).
                  255 = designated wilderness area.
        mvum: Optional[np.ndarray] of MVUM access values (uint8).
                  0 = no MVUM data, 1 = open, 255 = closed to this mode.
                  MVUM closures respond to boundary_mode (strict/pragmatic/emergency).
                  Foot mode should pass None (MVUM is motor-vehicle specific).
        boundary_mode: How to handle barriers ("strict", "pragmatic", "emergency")
        mode: Travel mode ("foot", "2w", "4w", "vehicle")

    Returns:
        2D array of travel cost in seconds per cell.
        np.inf for impassable cells.
    """
    if boundary_mode not in ("strict", "pragmatic", "emergency"):
        raise ValueError(f"boundary_mode must be 'strict', 'pragmatic', or 'emergency'")

    if mode not in MODE_PROFILES:
        raise ValueError(f"mode must be one of {list(MODE_PROFILES.keys())}")

    profile = MODE_PROFILES[mode]

    if cell_size_lat_m is None:
        cell_size_lat_m = cell_size_m
    if cell_size_lon_m is None:
        cell_size_lon_m = cell_size_m

    rows, cols = elevation.shape

    # ─── Compute gradients (in-place where possible) ─────────────────────────
    # Use float32 to reduce memory footprint
    grade = np.zeros(elevation.shape, dtype=np.float32)

    # Compute dy contribution to grade squared
    dy_contrib = np.zeros(elevation.shape, dtype=np.float32)
    dy_contrib[1:-1, :] = ((elevation[:-2, :] - elevation[2:, :]) / (2 * cell_size_lat_m)) ** 2
    dy_contrib[0, :] = ((elevation[0, :] - elevation[1, :]) / cell_size_lat_m) ** 2
    dy_contrib[-1, :] = ((elevation[-2, :] - elevation[-1, :]) / cell_size_lat_m) ** 2

    # Compute dx contribution and add to dy_contrib in-place
    dy_contrib[:, 1:-1] += ((elevation[:, 2:] - elevation[:, :-2]) / (2 * cell_size_lon_m)) ** 2
    dy_contrib[:, 0] += ((elevation[:, 1] - elevation[:, 0]) / cell_size_lon_m) ** 2
    dy_contrib[:, -1] += ((elevation[:, -1] - elevation[:, -2]) / cell_size_lon_m) ** 2

    # grade = sqrt(dx^2 + dy^2)
    np.sqrt(dy_contrib, out=grade)
    del dy_contrib  # Free memory immediately

    # ─── Compute speed based on mode ─────────────────────────────────────────
    max_grade_val = np.tan(np.radians(profile.max_slope_deg))

    if profile.speed_function == "tobler":
        speed_kmh = tobler_off_path_speed(grade, profile.base_speed_kmh)
    elif profile.speed_function == "herzog":
        speed_kmh = herzog_wheeled_speed(grade, profile.base_speed_kmh)
    elif profile.speed_function == "linear":
        speed_kmh = linear_degrade_speed(grade, profile.base_speed_kmh, max_grade_val)
    else:
        raise ValueError(f"Unknown speed function: {profile.speed_function}")

    # ─── Base cost (seconds per cell) ─────────────────────────────────────────
    avg_cell_size = (cell_size_lat_m + cell_size_lon_m) / 2
    cost = (avg_cell_size * 3.6) / speed_kmh
    del speed_kmh

    # ─── Max slope limit ──────────────────────────────────────────────────────
    cost[grade > max_grade_val] = np.inf

    # ─── NaN elevations ──────────────────────────────────────────────────────
    cost[np.isnan(elevation)] = np.inf

    # ─── Apply friction in-place ─────────────────────────────────────────────
    # Instead of creating effective_friction copy, apply directly to cost

    # Start with base friction
    if friction is not None:
        if friction.shape != elevation.shape:
            raise ValueError(f"Friction shape mismatch")
        np.multiply(cost, friction, out=cost)

    # ─── Mode-specific terrain friction overrides (memory-efficient) ─────────
    if friction_raw is not None and profile.terrain_friction_override:
        if friction_raw.shape != elevation.shape:
            raise ValueError(f"Friction_raw shape mismatch")

        # Process all overrides without creating large intermediate masks
        for wc_class, override in profile.terrain_friction_override.items():
            if override is not None:
                if override == np.inf:
                    # Use np.where for in-place-like behavior
                    np.putmask(cost, friction_raw == wc_class, np.inf)
                else:
                    # Multiply cost where friction_raw matches
                    # Using a loop with putmask is more memory efficient
                    mask = friction_raw == wc_class
                    cost[mask] *= override
                    del mask

    # ─── Vehicle mode: allow flat grassland/cropland ─────────────────────────
    if mode == "vehicle" and profile.off_trail_flat_threshold_deg > 0:
        if friction_raw is not None:
            # Compute slope in degrees for flat terrain check
            slope_deg = np.degrees(np.arctan(grade))
            # Flat grassland or cropland - recompute cost for these cells
            flat_field_mask = (
                (slope_deg <= profile.off_trail_flat_threshold_deg) &
                ((friction_raw == 30) | (friction_raw == 40))
            )
            del slope_deg
            # Recalculate cost for these cells with flat field friction
            if np.any(flat_field_mask):
                base_time = avg_cell_size * 3.6 / linear_degrade_speed(
                    grade[flat_field_mask], profile.base_speed_kmh, max_grade_val
                )
                cost[flat_field_mask] = base_time * profile.off_trail_flat_friction
                del base_time
            del flat_field_mask

    # ─── Trail friction (mode-specific) ──────────────────────────────────────
    if trails is not None:
        if trails.shape != elevation.shape:
            raise ValueError(f"Trails shape mismatch")

        for trail_value, trail_friction in profile.trail_friction.items():
            if trail_friction is None:
                # Impassable for this mode
                np.putmask(cost, trails == trail_value, np.inf)
            else:
                # Trail friction REPLACES terrain friction
                # Recalculate cost = base_time * trail_friction
                trail_mask = trails == trail_value
                if np.any(trail_mask):
                    # Get base travel time (without friction)
                    if profile.speed_function == "tobler":
                        trail_speed = tobler_off_path_speed(grade[trail_mask], profile.base_speed_kmh)
                    elif profile.speed_function == "herzog":
                        trail_speed = herzog_wheeled_speed(grade[trail_mask], profile.base_speed_kmh)
                    else:
                        trail_speed = linear_degrade_speed(
                            grade[trail_mask], profile.base_speed_kmh, max_grade_val
                        )
                    cost[trail_mask] = (avg_cell_size * 3.6 / trail_speed) * trail_friction
                    del trail_speed
                del trail_mask

    # ─── Wilderness areas (mode-specific) ────────────────────────────────────
    if wilderness is not None and profile.wilderness_impassable:
        if wilderness.shape != elevation.shape:
            raise ValueError(f"Wilderness shape mismatch")
        np.putmask(cost, wilderness == 255, np.inf)

    # ─── Barriers (private land) ─────────────────────────────────────────────
    if barriers is not None and boundary_mode != "emergency":
        if barriers.shape != elevation.shape:
            raise ValueError(f"Barriers shape mismatch")

        if boundary_mode == "strict":
            np.putmask(cost, barriers == 255, np.inf)
        elif boundary_mode == "pragmatic":
            barrier_mask = barriers == 255
            cost[barrier_mask] *= PRAGMATIC_BARRIER_MULTIPLIER
            del barrier_mask

    # ─── MVUM closures (motor vehicle restrictions) ──────────────────────────
    # MVUM only applies to motorized modes, not foot. Foot mode should pass mvum=None.
    # MVUM closures respond to the same boundary_mode as PAD-US barriers:
    #   "strict"    = MVUM-closed road/trail is impassable
    #   "pragmatic" = MVUM-closed road/trail gets 5× friction penalty
    #   "emergency" = MVUM closures ignored entirely
    if mvum is not None and mode != "foot" and boundary_mode != "emergency":
        if mvum.shape != elevation.shape:
            raise ValueError(f"MVUM shape mismatch")

        # Value 255 = road/trail exists but is closed to this mode
        mvum_closed_mask = mvum == 255

        if boundary_mode == "strict":
            np.putmask(cost, mvum_closed_mask, np.inf)
        elif boundary_mode == "pragmatic":
            cost[mvum_closed_mask] *= PRAGMATIC_BARRIER_MULTIPLIER

        del mvum_closed_mask

    return cost


# ═══════════════════════════════════════════════════════════════════════════════
# UNIFIED COST LAYERS (unified-graph Auto, spec §3.2)
# ═══════════════════════════════════════════════════════════════════════════════

def _corridor_mask(shape, meta, endpoint_line, pad_km, endpoint_pad_km):
    """Boolean grid, True where a cell lies OUTSIDE the great-circle corridor: its
    perpendicular distance to the start↔end line exceeds `pad_km`, or it falls more than
    `endpoint_pad_km` past either endpoint along the line. Vectorised local-equirectangular
    planar approximation (the corridor is one local region; sub-km error over ~200 km).

    Phase 4.5 perf: a `dem_reader.get_elevation_grid` bbox is axis-aligned, so it cannot be
    shrunk below the endpoint bounding box. Instead of shrinking the grid we mask it — cells
    outside the corridor are made impassable so the A* kernel never floods the off-route
    wilderness, which is where the long-route kernel time goes."""
    (lat0, lon0), (lat1, lon1) = endpoint_line
    rows, cols = shape
    ky = 111.0
    kx = 111.0 * math.cos(math.radians((lat0 + lat1) / 2.0))
    lat = meta["origin_lat"] + np.arange(rows)[:, None] * meta["pixel_size_lat"]   # (rows,1)
    lon = meta["origin_lon"] + np.arange(cols)[None, :] * meta["pixel_size_lon"]   # (1,cols)
    y = (lat - lat0) * ky          # km north of start  (rows,1)
    x = (lon - lon0) * kx          # km east  of start  (1,cols)
    ex = (lon1 - lon0) * kx
    ey = (lat1 - lat0) * ky
    L = math.hypot(ex, ey)
    if L < 1e-6:
        return np.zeros(shape, dtype=bool)   # degenerate (start==end): no corridor
    ux, uy = ex / L, ey / L
    t = x * ux + y * uy            # along-line km   (rows,cols)
    d = np.abs(x * uy - y * ux)    # perpendicular km (rows,cols)
    return (d > pad_km) | (t < -endpoint_pad_km) | (t > L + endpoint_pad_km)


def compute_unified_cost_layers(
    elevation: np.ndarray,
    friction: Optional[np.ndarray],
    friction_raw: Optional[np.ndarray],
    trails: Optional[np.ndarray],
    wilderness: Optional[np.ndarray],
    meta: dict,
    modes=("foot", "2w", "4w", "vehicle"),
    boundary_mode: Literal["strict", "pragmatic", "emergency"] = "pragmatic",
    endpoint_line=None,
    valhalla_url=None,
    mvum_by_mode: Optional[Dict[str, np.ndarray]] = None,
    network_affinity: Optional[Dict[str, float]] = None,
    corridor_pad_km: Optional[float] = None,
    corridor_endpoint_pad_km: float = 0.0,
) -> dict:
    """Per-mode inflated cost layers + mode-transition cells for one Auto search
    (spec §3.2 / §4 / §5 / §8). Returns {"cost_mult": {mode: ndarray}, "transition_cells":
    [(row, col, from_idx, to_idx, cost_s), ...], "meta": {...DEMReader meta, +
    "boundary_mode"}}.

    Rasters are INJECTED, not fetched: the raster IO lives on the router's reader objects
    (router.py::_pathfind_wilderness) and is not duplicated — Phase 4 passes the rasters +
    DEMReader `meta` straight in; tests pass synthetic arrays. Each mode's multiplier comes
    from compute_cost_multiplier_grid(...), then (still pre-inflation) MVUM closures (§9) and
    (post-inflation) network_affinity (§8) are applied, then inflate_cost_multiplier(...).
    The four per-mode layers are built CONCURRENTLY (Phase 4.5 perf): numpy/scipy release the
    GIL on the heavy compute, and the layers are independent. Assembly is deterministic
    (ordered by `modes`, not completion order).

    mvum_by_mode: optional {mode: uint8[rows,cols]} (1=open, 255=closed, 0=unknown). For
    each MOTORIZED mode, closed cells become impassable under `strict`, ×PRAGMATIC under
    `pragmatic`, ignored under `emergency`; foot skips MVUM entirely. network_affinity:
    optional {mode: float} multiplying that mode's on-network cells (trails != 0); default
    1.0 is a no-op. corridor_pad_km: when set (with endpoint_line), cells > pad_km from the
    great-circle line are made impassable in every layer (Phase 4.5 kernel speedup, §A).
    mvum_by_mode=network_affinity=corridor_pad_km=None reproduces the Phase-3 layers exactly,
    keeping the parity test green.
    """
    from .astar import inflate_cost_multiplier
    from .transitions import gather_transition_cells
    from concurrent.futures import ThreadPoolExecutor

    cell_size_m = float(meta["cell_size_m"])
    network_affinity = network_affinity or {}
    on_network = (trails != 0) if trails is not None else None

    def _build_mode_layer(mode):
        m = compute_cost_multiplier_grid(
            elevation,
            cell_size_lat_m=cell_size_m,
            cell_size_lon_m=cell_size_m,
            friction=friction,
            friction_raw=friction_raw,
            wilderness=wilderness,
            mode=mode,
        )
        # §9 MVUM closures: motorized modes only, pre-inflation (closures must bleed like any
        # impassable cell), modulated by boundary_mode.
        if mvum_by_mode is not None and mode != "foot" and boundary_mode != "emergency":
            mv = mvum_by_mode.get(mode)
            if mv is not None:
                closed = mv == 255
                if boundary_mode == "strict":
                    m[closed] = np.inf
                else:  # pragmatic
                    m[closed & np.isfinite(m)] *= PRAGMATIC_BARRIER_MULTIPLIER
        inflated = inflate_cost_multiplier(m)
        # §8 network_affinity, applied AFTER inflation: a >1 penalty on on-network cells must
        # NOT bleed into off-network neighbours (pre-inflation it makes LEAVING the network
        # harder -- the opposite of intent). The kernel costs on-network EDGES from
        # trail_friction (not cost_mult), so this is a no-op for movement today; the functional
        # bias is applied to trail_friction in router packing. Kept here per spec §8.
        aff = float(network_affinity.get(mode, 1.0))
        if aff != 1.0 and on_network is not None:
            inflated[on_network & np.isfinite(inflated)] *= aff
        return mode, inflated

    # Build all modes concurrently; assemble deterministically in `modes` order.
    with ThreadPoolExecutor(max_workers=max(1, len(modes))) as ex:
        built = dict(ex.map(_build_mode_layer, modes))
    cost_mult = {mode: built[mode] for mode in modes}

    # Corridor mask (Phase 4.5, §A): cells outside the great-circle corridor are made
    # impassable so the A* kernel never floods the off-route wilderness. Applied AFTER
    # inflation so the wall is crisp (no blur bleed inward). Off-trail only -- the kernel
    # costs on-trail edges from trail_friction, not cost_mult, so a road that bulges past
    # the band stays usable. A routable off-trail detour wider than corridor_pad_km is cut;
    # widen the pad knob (router.CORRIDOR_PAD_KM) if that ever bites.
    if endpoint_line is not None and corridor_pad_km is not None:
        mask = _corridor_mask(elevation.shape, meta, endpoint_line,
                              corridor_pad_km, corridor_endpoint_pad_km)
        for mode in modes:
            cost_mult[mode][mask] = np.inf

    transition_cells = gather_transition_cells(
        meta,
        endpoint_line=endpoint_line,
        trail_grid=trails,
        elevation=elevation,
        valhalla_url=valhalla_url,
    )

    out_meta = dict(meta)
    out_meta["boundary_mode"] = boundary_mode
    return {
        "cost_mult": cost_mult,
        "transition_cells": transition_cells,
        "meta": out_meta,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# LEGACY API (backward compatibility)
# ═══════════════════════════════════════════════════════════════════════════════

def tobler_speed(grade: float) -> float:
    """Legacy single-value Tobler speed function."""
    return 0.6 * 6.0 * math.exp(-3.5 * abs(grade + 0.05))


# ═══════════════════════════════════════════════════════════════════════════════
# TESTING
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 70)
    print("OFFROUTE Multi-Mode Cost Function Tests")
    print("=" * 70)

    print("\n[1] Speed functions at various grades:")
    print(f"{'Grade':<10} {'Foot':<12} {'MTB':<12} {'ATV':<12} {'Vehicle':<12}")
    print("-" * 60)

    for grade_val in [-0.3, -0.1, 0.0, 0.1, 0.2, 0.3]:
        grade_arr = np.array([grade_val])
        foot = tobler_off_path_speed(grade_arr, 6.0)[0]
        mtb = herzog_wheeled_speed(grade_arr, 12.0)[0]
        atv = herzog_wheeled_speed(grade_arr, 25.0)[0]
        veh = linear_degrade_speed(grade_arr, 40.0, np.tan(np.radians(20)))[0]
        print(f"{grade_val:+.2f}      {foot:>6.2f} km/h   {mtb:>6.2f} km/h   {atv:>6.2f} km/h   {veh:>6.2f} km/h")

    print("\n[2] Mode profiles:")
    for name, profile in MODE_PROFILES.items():
        print(f"\n  {name.upper()}: {profile.description}")
        print(f"    Max slope: {profile.max_slope_deg}°")
        print(f"    Trail access: {profile.trail_friction}")
        print(f"    Wilderness blocked: {profile.wilderness_impassable}")

    print("\n[3] Cost grid test (flat terrain, forest):")
    elev = np.ones((10, 10), dtype=np.float32) * 1000
    friction = np.ones((10, 10), dtype=np.float32) * 2.0  # Forest friction
    friction_raw = np.ones((10, 10), dtype=np.uint8) * 10  # Tree cover class

    trails = np.zeros((10, 10), dtype=np.uint8)
    trails[5, :] = 5  # Road across middle

    for mode_name in ["foot", "2w", "4w", "vehicle"]:
        cost = compute_cost_grid(
            elev, cell_size_m=30.0,
            friction=friction,
            friction_raw=friction_raw,
            trails=trails,
            mode=mode_name
        )
        off_trail_cost = cost[0, 0]
        road_cost = cost[5, 0]
        impassable = np.sum(np.isinf(cost))
        print(f"  {mode_name:8s}: off-trail={off_trail_cost:>8.1f}s, road={road_cost:>6.1f}s, impassable={impassable}")

    print("\n[4] Wilderness blocking test:")
    wilderness = np.zeros((10, 10), dtype=np.uint8)
    wilderness[3:7, 3:7] = 255

    for mode_name in ["foot", "2w", "4w", "vehicle"]:
        cost = compute_cost_grid(
            elev, cell_size_m=30.0,
            wilderness=wilderness,
            mode=mode_name
        )
        wilderness_impassable = np.sum(np.isinf(cost[3:7, 3:7]))
        print(f"  {mode_name:8s}: wilderness cells impassable = {wilderness_impassable}/16")

    print("\nDone.")
