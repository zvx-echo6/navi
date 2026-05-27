# Unified-Graph Auto Routing — Architecture Spec (Path A)

**Status:** Phase 1 of 7 — design only, no code.
**Scope:** This document specifies the unified `(row, col, mode)` A* refactor of
Auto routing for `navi_offroute`. It supersedes the brute-force hybrid pair
enumeration (`_try_hybrid_auto`) and the per-scenario dispatch (`_route_A/B/C/D`)
for the **Auto** mode only. Explicit-mode requests (Foot/2w/4w/Drive) are
untouched.

Baseline: PR #36 (`51bad71`) shipped classify-once / route-once and killed the
4-mode contest.

---

## 1. Problem statement

`_route_auto` (`router.py` ~810) today picks the highest-priority mode in
`start_class ∩ end_class`, calls `self.route(mode=picked)` once, then probes
`_try_hybrid_auto` (`router.py` ~945) for a drive→walk pair. Two engines are
stitched at `entry_points`: Valhalla (on-network, mode-pinned) plus the custom
A* `astar_multigoal` (`astar.py`, off-network, mode-pinned, DEM-grid). Scenario
dispatch (`_route_A/B/C/D`, `router.py` ~1242–1500) routes per on/off-network
endpoint combination.

### Failure case driving the refactor

> Click in wilderness (no road within `AUTO_SNAP_RELAXED_M=100` m) → home
> (tagged address).
>
> **Trace:** `start_class={foot}`, `end_class={vehicle,4w,2w,foot}`,
> intersection=`{foot}`, mode=foot, routed entirely on foot.
>
> `_try_hybrid_auto` only goes drive→walk and can't drive out of a wilderness
> start. Whole 60+ km routed on foot. User expected walk-out-to-road, then
> drive.

The root defect is structural: Auto commits to **one mode for the entire trip**
(the intersection of endpoint eligibilities), and the only escape hatch —
`_try_hybrid_auto` — is hard-wired to a `drive → switch → offroad` ordering
(`HYBRID_PAIRS`, `router.py` ~115). A trip that must begin off-network on foot
and then *acquire* a faster mode at a road has no representation in the current
model. The intersection collapses to `{foot}` and the whole route is walked.

The fix is to stop choosing a single trip-wide mode. Mode becomes part of the
search state, and switching modes becomes an *edge* the planner can take where
the world permits it (a parking lot, a trailhead, a road terminus). This is the
OTP `CAR_PICKUP` analogue: the optimizer decides where the mode change happens,
not a fixed leg ordering.

---

## 2. Target architecture

### 2.1 State space

The search state is the triple:

```
state = (row, col, mode)
```

- `row, col` — DEM/cost-grid pixel, as today (`astar_multigoal`).
- `mode ∈ {foot, 2w, 4w, vehicle}` — the **active travel mode** in that cell.

`n_modes = 4`, fixed-index ordering:

```
MODE_INDEX = {"foot": 0, "2w": 1, "4w": 2, "vehicle": 3}
MODE_ORDER = ["foot", "2w", "4w", "vehicle"]
```

Two kinds of edges connect states:

1. **Movement edges** — `(r, c, m) → (r', c', m)`: same mode, 8-neighbour grid
   step, cost identical to today's per-edge anisotropic cost computed against
   mode `m`'s cost layer (slope-aware speed, trail friction, barrier/boundary
   rule). Mode does not change.
2. **Transition edges** — `(r, c, m) → (r, c, m')`: same cell, mode changes
   `m → m'`, cost is a flat per-transition-type time penalty (§4). Allowed only
   at **transition cells** (§4–§5) and only for the directed `(m, m')` pairs
   that type permits.

### 2.2 Mode set

`{foot, 2w, 4w, vehicle}` — exactly the keys of `MODE_PROFILES` (`cost.py`
~105). No new modes. Each mode keeps its existing `ModeProfile`
(speed function, max slope, trail friction, terrain overrides, wilderness
flag). foot is the universal mode: always passable (`wilderness_impassable=False`),
present in every transition pair.

### 2.3 New A* signature

A new kernel `astar_multigoal_multimode` extends `astar_multigoal`
(`astar.py` ~83) to the 3D state space. It is JIT-compiled the same way
(`@njit(cache=True)`). Single-mode `astar_multigoal` is **retained unchanged**
for explicit-mode requests; the multimode kernel is invoked only by Auto.

```python
@njit(cache=True)
def astar_multigoal_multimode(
    cost_mult_stack,        # 3D float64 [rows, cols, n_modes]: per-cell context
                            #   multiplier per mode, post-inflation (inf=impassable)
    elevation,              # 2D float64: metres (NaN = impassable)
    cell_size_lat_m,        # float
    cell_size_lon_m,        # float
    max_grade_arr,          # 1D float64 [n_modes]: tan(max_slope) per mode
    speed_function_ids,     # 1D int [n_modes]: 0=tobler 1=herzog 2=linear
    base_speed_kmh_arr,     # 1D float64 [n_modes]
    trail_grid,             # 2D uint8: 0=none else trail value (5/15/25)
    trail_friction_stack,   # 2D float64 [n_modes, 256]: friction by trail value
                            #   per mode (inf=impassable)
    barrier_grid,           # 2D uint8: 255=barrier
    boundary_mode_id,       # int: 0=strict 1=pragmatic 2=emergency
    origin_row, origin_col,
    origin_modes,           # 1D int: allowed start modes (seeds) -- see §6
    goal_rows, goal_cols,   # 1D int arrays
    goal_modes,             # 1D int: allowed end modes -- see §6, §10
    trans_rows,             # 1D int [n_trans]: transition cell rows
    trans_cols,             # 1D int [n_trans]: transition cell cols
    trans_from_mode,        # 1D int [n_trans]: source mode index
    trans_to_mode,          # 1D int [n_trans]: target mode index
    trans_cost_s,           # 1D float64 [n_trans]: transition penalty seconds
):
    """A* over (row, col, mode). The first (goal cell, allowed goal mode) state
    popped wins; optimal under the per-mode admissible heuristic (§10). Returns
    (best_goal_idx, path, total_cost) where path is int64 (N,3) of (row,col,mode)
    from an origin-mode seed to the goal. (-1, empty, inf) if unreachable."""
```

Notes:
- Goal acceptance: a popped state `(r, c, m)` is a goal iff `(r, c)` is a goal
  cell **and** `m ∈ goal_modes`. This lets the search arrive in any mode the
  destination supports (§6).
- Multiple origin seeds: every mode in `origin_modes` is pushed at the origin
  cell with `g=0`, so the search may *start* in any eligible start mode and
  switch later.
- Transition edges are looked up per popped cell: a small per-cell index built
  from `trans_*` arrays (a dict `(r,c) -> list of (from,to,cost)` constructed
  once before the loop, numba-typed) lets the relaxation step add same-cell
  mode-change neighbours alongside the 8 grid neighbours.

### 2.4 New `_route_auto` flow (pseudocode)

```
def _route_auto(start, end, boundary_mode, start_category, end_category):
    # 1. Bootstrap eligibility (classifier, NOT routing decision) -- §6
    allowed_start_modes = eligible_modes(start, start_category)   # combined /locate
    allowed_end_modes   = eligible_modes(end,   end_category)
    # foot is always in both sets.

    # 2. Build the bbox covering both endpoints (+ margin), as the scenario
    #    handlers do today via _build_grid (shared elevation/friction/trails/
    #    barriers fetch).
    bbox = bbox_for(start, end, margin)

    # 3. Per-mode cost layers + transition cells -- §3, §4, §5
    layers = compute_unified_cost_layers(
        bbox, modes={foot,2w,4w,vehicle}, boundary_mode=boundary_mode)
    #   layers.cost_mult[mode]  -> inflated cost-mult grid
    #   layers.transition_cells -> [(row,col,from_mode,to_mode,cost_s), ...]

    # 4. Single unified search
    origin_modes = modes_to_indices(allowed_start_modes)
    goal_modes   = modes_to_indices(allowed_end_modes)
    idx, path, cost = astar_multigoal_multimode(
        cost_mult_stack=stack(layers.cost_mult),
        elevation=..., trail_grid=..., barrier_grid=...,
        boundary_mode_id=id(boundary_mode),
        origin_row, origin_col, origin_modes,
        goal_rows=[dest_row], goal_cols=[dest_col], goal_modes,
        trans_*=unpack(layers.transition_cells),
    )

    # 5. Render: split path into per-mode segments at the mode-change indices,
    #    build the GeoJSON FeatureCollection, attach selected_mode_set =
    #    sorted(distinct modes used along the path). No auto_fallback_from (§7).
    return build_response(path, cost, allowed_start_modes | allowed_end_modes)
```

The destination is a single goal cell (the click/address), not a set of network
`entry_points` — the unified search reaches the network naturally via movement
edges. `entry_points` / `EntryPointIndex` remain in use for the explicit-mode
scenario handlers (§13).

---

## 3. Cost model

### 3.1 Reuse `MODE_PROFILES` as-is

No rework of `MODE_PROFILES` (`cost.py` ~105) or the speed functions
(`tobler_off_path_speed`, `herzog_wheeled_speed`, `linear_degrade_speed`). Each
mode's per-cell context cost is still produced by `compute_cost_multiplier_grid`
(`cost.py` ~221) and inflated by `inflate_cost_multiplier` (`astar.py` ~36). The
multimode kernel reads one inflated grid **per mode**, stacked along a new axis.

### 3.2 New helper

```python
def compute_unified_cost_layers(
    bbox, modes, boundary_mode,
) -> dict:
    """Build the per-mode cost stack and the mode-transition cell list for one
    Auto search over `bbox`.

    Returns:
      {
        "cost_mult":        {mode: np.ndarray[rows, cols] float64},  # inflated
        "transition_cells": [ (row, col, from_mode, to_mode, cost_s), ... ],
      }

    For each mode it calls compute_cost_multiplier_grid(...) with that mode's
    profile + the shared elevation/friction/trails/barriers/wilderness rasters
    for the bbox, then inflate_cost_multiplier(...). boundary_mode flows
    straight through to the underlying barrier/MVUM rules (§9). The transition
    cell list is gathered from the four sources in §4, mapped to grid pixels,
    de-duplicated per (cell, from, to), and capped per §5."""
```

`compute_unified_cost_layers` lives in `cost.py` (cost-layer assembly) and
delegates transition-cell gathering to a new `transitions.py` (the index
queries + grid-pixel mapping + cap), keeping the raster math and the spatial
sourcing separable. Phase 3 builds both.

---

## 4. Transition edges (named constants in `cost.py`)

Each transition type contributes directed mode-change edges at its cells with a
fixed time penalty. Constants are defined in `cost.py` alongside
`PRAGMATIC_BARRIER_MULTIPLIER`:

```python
# Mode-switch transition penalties (seconds), unified-graph Auto.
TRANSITION_COST_PARKING_S       = 60.0   # park & switch at a lot
TRANSITION_COST_TRAILHEAD_S     = 30.0   # stage at a trailhead
TRANSITION_COST_ROAD_TERMINUS_S = 60.0   # leave/meet vehicle at road end
TRANSITION_COST_SURFACE_CHANGE_S = 0.0   # surface boundary, free swap
```

| Source | Index / fn | Allowed switches (bidirectional) | Cost |
|---|---|---|---|
| Parking | `OSMParkingIndex` (`mvum_parking.py` ~44) | foot↔vehicle, foot↔4w, foot↔2w | **60 s** |
| Trailheads | `TrailheadIndex` (`mvum_transitions.py` ~34) | foot↔4w, foot↔2w | **30 s** |
| Road termini | last on-network OSM node before off-grid | foot↔vehicle | **60 s** |
| Surface-change | `get_surface_change_candidates` (`mvum_surface_change.py` ~191) | mode swap along route | **0 s** |

Semantics:
- "Bidirectional" means each listed `m↔m'` expands to two directed edges
  `(r,c,m)→(r,c,m')` and `(r,c,m')→(r,c,m)`, each carrying the type's cost.
- Parking is the broadest switch (covers leaving any wheeled mode for foot and
  vice-versa), reflecting BLM/state/private + urban lots where MVUM trailheads
  don't exist.
- Trailheads stage foot↔wheeled-offroad only (no full-size `vehicle`): trailhead
  parking is for the tow vehicle; you continue on 4w/2w or foot.
- Road termini model the wilderness failure case directly: the foot path out of
  the backcountry meets the road network at the last drivable OSM node, where a
  foot→vehicle switch becomes available. **This is the edge that fixes §1.**
- Surface-change cells are free (0 s): they represent a mode the route was
  already going to want (pavement→dirt), not a physical staging delay.

Road-terminus sourcing: the last on-network OSM node before off-grid is derived
from a Valhalla `/locate`-style snap at the off-network boundary; Phase 3 wires
the exact query (candidate: reuse `_locate_on_network`, `router.py` ~571, at the
foot path's network-contact cells). Listed as a named source here; its precise
extraction is a Phase 3 design item flagged in §14.

---

## 5. Transition cell cap

Unbounded transition cells would blow up both the per-cell index and the
state-space branching. Cap:

> For each transition **type**, keep the closest **15** cells that lie within
> **5 km** of the great-circle line between the two endpoints.

- Distance is measured to the great-circle line (start↔end), matching the
  "closest to route" spirit of the existing hybrid candidate sort
  (`_try_hybrid_auto`, `router.py` ~982–985) but using the straight endpoint
  line rather than a routed polyline (there is no pre-route polyline in the
  unified flow).
- "Per type" means up to 15 parking + 15 trailhead + 15 road-terminus +
  15 surface-change cells, gathered and capped independently, then merged.
- The 5 km band keeps the candidate set near the corridor of interest without
  requiring a first-pass route.

---

## 6. Spatial probe disposition (KEPT, reframed)

`_spatial_eligible_modes` (`router.py` ~771) is **kept** as the bootstrap
classifier for **untagged** endpoints, but its role changes:

- **Before:** load-bearing. It produced the eligible-mode set that, intersected
  across endpoints, *chose the single trip mode*.
- **After:** a *seed* generator. It produces `allowed_start_modes` /
  `allowed_end_modes`, which become `origin_modes` / `goal_modes` for the
  unified A*. It no longer decides the route — the search does.

Reframe to **one combined `/locate` call**:

- Today it fires three parallel costings (`auto`/`pedestrian`/`bicycle`) via a
  `ThreadPoolExecutor` (`router.py` ~777–784).
- Valhalla `/locate` accepts multiple costings / a batch of locations in one
  request; collapse the three probes into a single combined `/locate` call per
  endpoint. Same per-mode snap-distance + road-class rules
  (`AUTO_SNAP_TIGHT_M`, `AUTO_SNAP_RELAXED_M`, `PAVED_HIGHWAY_CLASSES`,
  `TRACK_USE_VALUES`, `PATH_USE_VALUES`), same `snap_cache` dedupe.
- foot stays universally eligible. Tagged endpoints still resolve via
  `_eligible_modes_from_category` (`router.py` ~740) with no probe.

Net: the probe seeds the search and is no longer load-bearing for routing
decisions. A mis-classified seed degrades gracefully — the search can still
switch into a mode at a transition cell even if that mode wasn't an origin/goal
seed, as long as the mode is reachable via a transition edge from a seeded mode.

---

## 7. `auto_fallback_from` response field — REMOVED

The PR #36 foot-as-last-resort patch sets `auto_fallback_from` on the response
when the capability-picked mode fails and foot succeeds (`router.py`
~888–902). Under the unified search there is **no single picked mode to fall
back from** — foot is one mode among four in the same search, and a foot-only
result simply means the optimizer found no cheaper mixed-mode path. The field is
**removed** from the Auto response shape. Fallback is implicit.

Frontend impact: `auto_fallback_from` consumers must be removed (§16 risk:
response-shape break). Tracked in the Phase 6 frontend cleanup.

---

## 8. New `network_affinity` request parameter

A new optional request parameter:

```
network_affinity: dict[mode -> float]   # default {} -> 1.0 per mode
```

A per-mode multiplier applied to **on-network cells** (cells whose `trail_grid`
marks a road/track, value 5/15) in that mode's cost layer. `< 1.0` biases the
search toward staying on the network in that mode; `> 1.0` penalizes it.
Default `1.0` is a no-op (identical behaviour to today).

- **Lands in Phase 4** (rewire), **backend-only this round** — accepted and
  threaded through `compute_unified_cost_layers`, no frontend control yet.
- Applied after `compute_cost_multiplier_grid`, before
  `inflate_cost_multiplier`, on the network-cell mask only.

---

## 9. Boundary mode

`strict` / `pragmatic` / `emergency` flows into
`compute_unified_cost_layers(bbox, modes, boundary_mode)` exactly as it does
today into `compute_cost_grid` / `compute_cost_multiplier_grid` — it governs the
barrier (PAD-US) and MVUM-closure rules per mode (`cost.py` ~474–503) and is
passed to the kernel as `boundary_mode_id` (`0/1/2`).

**Mode-switch edges are barrier-free transitions.** A transition edge changes
mode in place at a known staging cell; it carries no terrain, no barrier, and no
boundary-mode semantics — only its flat per-type time penalty (§4). Boundary
mode affects only the movement edges (the cost layers), never the switch edges.

---

## 10. Heuristic admissibility

The remaining-cost heuristic for a state `(r, c, m)` must never overestimate the
true cost to any goal, across **all** reachable goal modes. Use the
**fastest mode that can reach the goal**:

```
h(r, c, m) = straight_line_distance(cell, nearest_goal_cell) * 3.6
             / max(base_speed_kmh[g] for g in allowed_end_modes)
```

- Take the **maximum** base speed over `allowed_end_modes` (`goal_modes`) — i.e.
  the *fastest* permissible finishing mode. Dividing distance by the largest
  speed yields the smallest possible time, so `h` underestimates → admissible.
- This generalizes the single-mode heuristic (`astar.py` ~120–128), which
  divides by the one mode's `base_speed_kmh`. With one allowed end mode the two
  expressions coincide.
- The heuristic ignores the current state's mode `m` deliberately: a state in a
  slow mode might still switch to a fast mode before the goal, so bounding by the
  fastest goal-reachable mode keeps `h` admissible (never optimistic-violating)
  for every state regardless of its current mode.
- Transition penalties are ≥ 0, so omitting them from `h` only makes `h` smaller
  — still admissible.

---

## 11. Numba state encoding

Heap id packs the 3D state into a single int64:

```
heap_id = mode * (rows * cols) + row * cols + col
# decode:
mode = heap_id // (rows * cols)
rem  = heap_id %  (rows * cols)
row  = rem // cols
col  = rem %  cols
```

Per-state arrays grow from 2D to 3D, indexed `[row, col, mode]`:

```
closed   : np.zeros((rows, cols, n_modes), dtype=np.bool_)
g_score  : np.full((rows, cols, n_modes), INF, dtype=np.float64)
parent   : np.full((rows, cols, n_modes), -1,  dtype=np.int64)  # stores parent heap_id
```

- Memory is ~`n_modes` (= 4) × the single-mode arrays; bounded by the bbox (the
  same bbox the scenario handlers build today), so the cap is the bbox cap.
- `parent` stores the parent's packed `heap_id` (not a cell id), so traceback
  can recover the mode at each step and thus the mode-change indices for
  rendering (§2.4 step 5).
- Heap capacity scales accordingly: `cap = rows * cols * n_modes * <fanout>`
  (today's `rows*cols*4`, `astar.py` ~113, generalizes — confirm fanout headroom
  in Phase 2 perf test).

---

## 12. What gets ripped

- `_try_hybrid_auto` (`router.py` ~945) — the brute-force drive→offroad pair
  enumeration over `HYBRID_PAIRS`. The unified search subsumes it. (Phase 5
  deprecates, Phase 4/5 stops calling it.)
- `_route_A/B/C/D` **as separate Auto dispatch paths**. Scenario D ("on-network
  → on-network") becomes simply "the A* search happened to never leave the
  on-network cells / never took a non-network movement edge." The handlers
  remain for explicit-mode routing (§13); only Auto stops dispatching through
  them.
- The 4-mode contest — already gone in PR #36; noted for completeness.
- foot-as-last-resort fallback (PR #36 patch, `router.py` ~885–906) and its
  `auto_fallback_from` field (§7).

---

## 13. What stays

- `MODE_PROFILES` and the speed functions (`cost.py`) — unchanged (§3).
- The `astar_multigoal` core search loop (`astar.py` ~83) — **extended, not
  replaced**. `astar_multigoal_multimode` is a sibling kernel; single-mode stays
  for explicit modes.
- `EntryPointIndex` (`router.py` ~185), `TrailheadIndex`
  (`mvum_transitions.py` ~34), `OSMParkingIndex` (`mvum_parking.py` ~44),
  `get_surface_change_candidates` (`mvum_surface_change.py` ~191) — reused as
  transition-cell sources (§4).
- `_locate_on_network` (`router.py` ~571) — on/off-network classification and
  road-terminus sourcing.
- `_spatial_eligible_modes` (`router.py` ~771) — kept, **reframed** as a seed
  generator (§6).
- `self.route(mode=...)` for explicit-mode requests — Drive / Foot / 2w / 4w
  picked manually still go through the existing scenario dispatch
  (`router.py` ~650–710). **Only `mode="auto"` switches to the unified search.**

---

## 14. Migration plan (file-by-file diff sketch)

Each phase ≤ 400 lines, HALT-at-diff at every boundary.

### Phase 1 — spec doc (THIS PR)
- `+ backend/services/navi_offroute/UNIFIED-GRAPH-SPEC.md` (this file).
- No code.

### Phase 2 — multi-mode kernel
- `astar.py`: `+ astar_multigoal_multimode` (new `@njit` kernel, §2.3, §10,
  §11). Factor the shared per-edge cost math so the two kernels don't diverge
  (helper `@njit` functions for slope penalty + speed, already partly inlined as
  `_speed_kmh`). `astar_multigoal` untouched behaviourally.
- `astar.py`: transition-cell per-cell index builder (numba-typed dict
  `(r,c) -> typed list`), built from `trans_*` arrays before the search loop.
- No `router.py`/`cost.py` wiring yet — kernel callable + unit-tested in
  isolation.

### Phase 3 — cost layers + transition sources
- `cost.py`: `+ TRANSITION_COST_*` constants (§4); `+ compute_unified_cost_layers`
  (§3.2).
- `+ transitions.py` (new): gather transition cells from the four sources (§4),
  map lat/lon → grid pixels for a given bbox/meta, de-dupe per (cell,from,to),
  apply the per-type closest-15-within-5km cap (§5). Road-terminus extraction
  finalized here (the §4 Phase-3 flag).
- No `_route_auto` rewire yet.

### Phase 4 — rewire Auto
- `router.py`: rewrite `_route_auto` (§2.4) to build the bbox + cost layers,
  call `astar_multigoal_multimode`, and render per-mode segments. Thread
  `network_affinity` through (§8, backend-only).
- `router.py`: `_spatial_eligible_modes` → one combined `/locate` call, return
  reframed as seeds (§6).
- `_try_hybrid_auto` still present but no longer called from `_route_auto`.
- Remove `auto_fallback_from` from the Auto path (§7).

### Phase 5 — remove hybrid + collapse scenario dispatch
- `router.py`: delete `_try_hybrid_auto` and the `HYBRID_*` constants
  (`router.py` ~107–115). Collapse `_route_A/B/C/D` Auto usage; keep them for
  explicit-mode dispatch (§13). Where an A/B/C/D handler is now only reachable
  by explicit mode, simplify its Auto-specific branches.

### Phase 6 — frontend cleanup
- `MapView.jsx`: color route by **route-mode-per-segment** (the §2.4 step-5
  segments), not by surface class. Consume `selected_mode_set` + per-segment
  mode.
- `DirectionsPanel.jsx`: drop `auto_fallback_from` handling (§7); render the
  mode-switch points (parking/trailhead/road-terminus) as step transitions.

### Phase 7 — deploy + smoke
- Deploy clone to VM 1130; run the Phase 4 integration + Phase 6 browser smoke
  (§15) on the deployed build. Repeated at every PR's deploy boundary.

---

## 15. Test plan

### Phase 2 (kernel unit, `tests/`)
- **foot-only parity:** with `origin_modes=goal_modes={foot}` and **no**
  transition cells, `astar_multigoal_multimode` returns the same path + cost as
  `astar_multigoal` for foot on a fixture grid (the extension is a strict
  superset).
- **parking-cell two-mode switch:** a grid with a foot-passable corridor to a
  parking cell, then a vehicle-fast road; assert the optimal path switches
  foot→vehicle at the parking cell and beats foot-only.
- **no-transition degradation:** transition list empty ⇒ behaves exactly like
  `n_modes` independent single-mode searches (no cross-mode coupling).
- **admissibility check:** assert `h(state) ≤ true_remaining_cost` over a sweep
  of states for a multi-goal-mode fixture (§10); assert the popped-goal-is-optimal
  invariant holds (compare against a Dijkstra/no-heuristic run).

### Phase 3 (cost-layer unit, `tests/`)
- **per-mode cost layers:** `compute_unified_cost_layers` returns one grid per
  mode matching `compute_cost_multiplier_grid` + `inflate_cost_multiplier` for
  that mode (per-mode wilderness/terrain overrides applied).
- **transition cell detection:** seeded parking/trailhead/road-terminus/surface
  fixtures map to the expected grid pixels with the correct directed
  `(from,to,cost)` triples.
- **cap correctness:** > 15 candidates of a type ⇒ exactly the closest 15 within
  5 km of the endpoint line survive (§5).
- **perf:** `≤ 1 s` to build all four layers + transition cells for a **50 km**
  bbox.

### Phase 4 (integration, `tests/`)
- **wilderness → home (the §1 failure case):** assert the result walks out to a
  road/parking/terminus, switches to vehicle, and the foot leg is short — *not*
  a 60 km foot route.
- **foot → off-path:** pure off-network foot trip still routes foot-only
  (no spurious switches).
- **road → road:** in-town trip stays on-network in a wheeled mode (the old
  Scenario D); fast, no off-grid excursion.
- **dirt-road untagged:** untagged dirt-road endpoint classified via the
  reframed combined `/locate` seed; routes in 4w/2w as appropriate.

### Phase 6 (browser smoke)
- Load each Phase 4 integration case in the UI; confirm per-segment mode
  coloring, mode-switch step markers, and absence of any `auto_fallback_from`
  reference.

---

## 16. Risk register

| Risk | Detail | Mitigation |
|---|---|---|
| Numba JIT on 3D arrays | `@njit` typing of 3D `closed`/`g_score`/`parent` + a numba-typed transition dict may fail to compile or fall to object mode | Phase 2 builds + benchmarks the kernel in isolation before any wiring; assert no object-mode fallback (numba `nopython`); keep `cache=True` warm-compile |
| 4× state-space explosion | `(row,col,mode)` is ~4× the single-mode search; heap + arrays grow, latency risk on large bbox | Bounded by the same bbox the scenario handlers build today; Phase 3 perf gate (≤1 s layers / 50 km) + Phase 2 fanout headroom check; per-mode admissible heuristic (§10) prunes hard |
| Scenario-removal regressions | Collapsing `_route_A/B/C/D` for Auto could regress edge cases those branches handled | Keep handlers for explicit mode (§13); Phase 4 integration covers all four old scenarios (road→road = old D, etc.); HALT-at-diff per phase |
| Response-shape break to frontend | `auto_fallback_from` removed (§7); per-segment mode shape changes | Phase 6 ships frontend cleanup in lockstep; Phase 4 keeps `selected_mode_set`; document the shape delta in the Phase 4/6 PR bodies |
| Deploy clone / remote drift | VM 1130 deploy clone may drift from `main`; smoke runs against stale build | Phase 7 redeploys the clone at every PR boundary before smoke; pin the deployed commit in the smoke report |
