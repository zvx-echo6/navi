"""Numba-jit anisotropic A* for wilderness pathfinding (replaces MCP_Geometric).

Single-mode, multi-goal least-time pathfinder over a raster grid. Unlike the old
isotropic MCP, the per-edge time is anisotropic: it depends on the *signed* slope
between the two cells (climbing != descending) via the mode's speed function
(signed Tobler / Herzog / linear), the average per-cell context multiplier of the
two endpoints (or the trail friction when either endpoint is on a trail), and a
barrier/boundary rule. The first goal cell popped from the open set wins, which is
optimal under the admissible heuristic (straight-line distance / base speed).

Cliffs (|grade| > max_grade) incur a smooth exponential penalty rather than a hard
wall, so a single noisy DEM cell can't fabricate an impassable edge; only truly
absurd grades (penalty > SLOPE_PENALTY_CAP) are dropped.
"""
import math

import numpy as np
from numba import njit
from scipy.ndimage import gaussian_filter

INF = np.inf

# Exponential-inflation parameters (see inflate_cost_multiplier).
INFLATE_SIGMA = 1.8           # ~25% contribution at a 3-cell radius
INFLATE_HARD_FACTOR = 50.0    # HARD sentinel = 50 x p95 of finite multipliers
INFLATE_HARD_CAP = 1e12       # cap to avoid float overflow in the blur

# Smooth slope penalty (replaces the old hard max_grade cliff). No penalty up to
# max_grade; past it the edge cost is multiplied by exp(overshoot * SCALE), so a single
# noisy DEM cell can't make an edge unconditionally impassable. Only truly absurd grades
# (penalty above the cap) are dropped.
SLOPE_PENALTY_SCALE = 10.0    # cost multiplier doubles for ~7% overshoot past max_grade
SLOPE_PENALTY_CAP = 1e6       # beyond this, treat as impassable (true bad data)


def inflate_cost_multiplier(mult, sigma=INFLATE_SIGMA):
    """Exponentially inflate a context-cost multiplier grid so hard cells bleed a
    decaying penalty into their neighbours, giving A* a smooth gradient field to
    descend instead of hugging walls.

    Impassable (inf) cells are replaced by a large finite HARD sentinel for the blur
    only, then restored to inf at their original positions so true impassability is
    preserved exactly. HARD = INFLATE_HARD_FACTOR * p95(finite), capped.
    """
    inf_mask = ~np.isfinite(mult)
    finite = mult[~inf_mask]
    if finite.size == 0:
        return np.full(mult.shape, np.inf, dtype=np.float64)
    p95 = float(np.percentile(finite, 95))
    hard = min(INFLATE_HARD_FACTOR * p95, INFLATE_HARD_CAP)
    work = np.where(inf_mask, hard, mult).astype(np.float64)
    blurred = gaussian_filter(work, sigma=sigma, mode="nearest")
    blurred[inf_mask] = np.inf
    return blurred


@njit(cache=True)
def _speed_kmh(signed_grade, speed_function_id, base_speed_kmh, max_grade):
    """Mode speed (km/h) for a signed grade. Inlined per speed_function_id:
    0=tobler (signed; peaks at grade=-0.05), 1=herzog wheeled, 2=linear degrade."""
    if speed_function_id == 0:
        return 0.6 * base_speed_kmh * math.exp(-3.5 * abs(signed_grade + 0.05))
    elif speed_function_id == 1:
        s = signed_grade
        sa = abs(s)
        denom = (1337.8 * s**6 + 278.19 * s**5 - 517.39 * s**4
                 - 78.199 * s**3 + 93.419 * s**2 + 19.825 * sa + 1.64)
        if denom < 0.1:
            denom = 0.1
        rel = 1.0 / denom
        if rel < 0.05:
            rel = 0.05
        elif rel > 1.5:
            rel = 1.5
        return base_speed_kmh * rel
    else:
        v = base_speed_kmh * (1.0 - abs(signed_grade) / max_grade)
        if v < 0.0:
            v = 0.0
        return v


@njit(cache=True)
def astar_multigoal(
    cost_mult,            # 2D float64: per-cell context multiplier, post-inflation (inf=impassable)
    elevation,            # 2D float64: metres (NaN = impassable)
    cell_size_lat_m,      # float
    cell_size_lon_m,      # float
    max_grade,            # float: tan(max_slope)
    speed_function_id,    # int: 0=tobler 1=herzog 2=linear
    base_speed_kmh,       # float
    trail_grid,           # 2D uint8: 0=none else trail value (5/15/25)
    trail_friction_lookup,  # 1D float64 len 256: friction by trail value (inf=impassable)
    barrier_grid,         # 2D uint8: 255=barrier
    boundary_mode_id,     # int: 0=strict 1=pragmatic 2=emergency
    origin_row, origin_col,
    goal_rows, goal_cols,  # 1D int arrays
):
    """A* from (origin_row,origin_col) to the nearest (by time) of the goals.
    Returns (best_goal_idx, path) where path is an int64 (N,2) array of (row,col)
    from origin to goal. (-1, empty) if no goal is reachable."""
    rows, cols = elevation.shape

    goal_index = np.full((rows, cols), -1, dtype=np.int64)
    for gi in range(goal_rows.shape[0]):
        goal_index[goal_rows[gi], goal_cols[gi]] = gi

    g_score = np.full((rows, cols), INF, dtype=np.float64)
    parent = np.full((rows, cols), -1, dtype=np.int64)
    closed = np.zeros((rows, cols), dtype=np.bool_)

    # Binary min-heap (lazy deletion): parallel id/priority arrays.
    cap = rows * cols * 4
    if cap < 1024:
        cap = 1024
    heap_id = np.empty(cap, dtype=np.int64)
    heap_f = np.empty(cap, dtype=np.float64)
    hsize = 0

    def heuristic(r, c):
        best = INF
        for gi in range(goal_rows.shape[0]):
            dr = (r - goal_rows[gi]) * cell_size_lat_m
            dc = (c - goal_cols[gi]) * cell_size_lon_m
            d = math.sqrt(dr * dr + dc * dc)
            if d < best:
                best = d
        return best * 3.6 / base_speed_kmh  # metres -> seconds at base speed

    # Seed origin.
    g_score[origin_row, origin_col] = 0.0
    heap_id[0] = origin_row * cols + origin_col
    heap_f[0] = heuristic(origin_row, origin_col)
    hsize = 1

    while hsize > 0:
        # Pop min.
        cur_id = heap_id[0]
        hsize -= 1
        heap_id[0] = heap_id[hsize]
        heap_f[0] = heap_f[hsize]
        i = 0
        while True:
            l = 2 * i + 1
            r = 2 * i + 2
            sm = i
            if l < hsize and heap_f[l] < heap_f[sm]:
                sm = l
            if r < hsize and heap_f[r] < heap_f[sm]:
                sm = r
            if sm != i:
                tid = heap_id[i]; heap_id[i] = heap_id[sm]; heap_id[sm] = tid
                tf = heap_f[i]; heap_f[i] = heap_f[sm]; heap_f[sm] = tf
                i = sm
            else:
                break

        cr = cur_id // cols
        cc = cur_id % cols
        if closed[cr, cc]:
            continue  # stale heap entry
        closed[cr, cc] = True

        if goal_index[cr, cc] >= 0:
            # First goal popped is optimal — trace back.
            length = 1
            node = cur_id
            while parent[node // cols, node % cols] != -1:
                length += 1
                node = parent[node // cols, node % cols]
            path = np.empty((length, 2), dtype=np.int64)
            node = cur_id
            k = length - 1
            while node != -1:
                pr = node // cols
                pc = node % cols
                path[k, 0] = pr
                path[k, 1] = pc
                k -= 1
                node = parent[pr, pc]
            return goal_index[cr, cc], path, g_score[cr, cc]

        g_cur = g_score[cr, cc]
        elev_cur = elevation[cr, cc]
        if math.isnan(elev_cur):
            continue

        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                nr = cr + dr
                nc = cc + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                    continue
                if closed[nr, nc]:
                    continue
                elev_n = elevation[nr, nc]
                if math.isnan(elev_n):
                    continue

                dlat = dr * cell_size_lat_m
                dlon = dc * cell_size_lon_m
                dist = math.sqrt(dlat * dlat + dlon * dlon)
                signed_grade = (elev_n - elev_cur) / dist
                # Smooth slope penalty: free up to max_grade, then an exponential ramp on
                # the overshoot; only an absurd grade (penalty > cap) is impassable.
                overshoot = abs(signed_grade) - max_grade
                slope_penalty = 1.0
                if overshoot > 0.0:
                    slope_penalty = math.exp(overshoot * SLOPE_PENALTY_SCALE)
                    if slope_penalty > SLOPE_PENALTY_CAP:
                        continue  # absurd grade (DEM noise or true vertical) -- give up
                spd = _speed_kmh(signed_grade, speed_function_id, base_speed_kmh, max_grade)
                if spd <= 1e-9:
                    continue
                base_time = dist * 3.6 / spd
                base_time *= slope_penalty

                tv_cur = trail_grid[cr, cc]
                tv_n = trail_grid[nr, nc]
                if tv_cur > 0 or tv_n > 0:
                    # Trail-takes-both: pick the lower-friction trail cell.
                    fc = trail_friction_lookup[tv_cur] if tv_cur > 0 else INF
                    fn = trail_friction_lookup[tv_n] if tv_n > 0 else INF
                    tf = fc if fc < fn else fn
                    if not (tf < INF):
                        continue  # impassable trail for this mode
                    edge = base_time * tf
                else:
                    mc = cost_mult[cr, cc]
                    mn = cost_mult[nr, nc]
                    if (not (mc < INF)) or (not (mn < INF)):
                        continue  # impassable terrain (incl. wilderness)
                    edge = base_time * 0.5 * (mc + mn)

                if boundary_mode_id == 0:  # strict
                    if barrier_grid[cr, cc] == 255 or barrier_grid[nr, nc] == 255:
                        continue
                elif boundary_mode_id == 1:  # pragmatic
                    if barrier_grid[cr, cc] == 255 or barrier_grid[nr, nc] == 255:
                        edge *= 5.0
                # emergency (2): ignore barriers

                tentative = g_cur + edge
                if tentative < g_score[nr, nc]:
                    g_score[nr, nc] = tentative
                    parent[nr, nc] = cur_id
                    f = tentative + heuristic(nr, nc)
                    if hsize < cap:
                        # push + sift-up
                        heap_id[hsize] = nr * cols + nc
                        heap_f[hsize] = f
                        j = hsize
                        hsize += 1
                        while j > 0:
                            par = (j - 1) // 2
                            if heap_f[j] < heap_f[par]:
                                tid = heap_id[j]; heap_id[j] = heap_id[par]; heap_id[par] = tid
                                tf2 = heap_f[j]; heap_f[j] = heap_f[par]; heap_f[par] = tf2
                                j = par
                            else:
                                break

    return -1, np.empty((0, 2), dtype=np.int64), INF


# ═══════════════════════════════════════════════════════════════════════════════
# MULTI-MODE A* (unified-graph, spec §2.3 / §10 / §11)
# ═══════════════════════════════════════════════════════════════════════════════
#
# astar_multigoal_multimode extends the single-mode search to a (row, col, mode)
# state space: mode is part of the state, and mode-switching transition edges
# (parking lots, trailheads, road termini, surface boundaries) let the optimizer
# decide WHERE a mode change happens instead of a fixed leg ordering. Single-mode
# astar_multigoal above is unchanged and still serves explicit-mode requests; this
# kernel is invoked only by Auto (wired in Phase 4).


@njit(cache=True)
def _movement_edge_time(cr, cc, nr, nc, dr, dc,
                        elevation, cost_mult, trail_grid, trail_friction_lookup,
                        barrier_grid, boundary_mode_id,
                        cell_size_lat_m, cell_size_lon_m,
                        max_grade, speed_function_id, base_speed_kmh):
    """Per-edge time (s) for one 8-neighbour grid step in a SINGLE mode, or INF if
    the edge is impassable / should be skipped. This is exactly the per-edge math
    inlined in astar_multigoal (smooth slope penalty, trail-takes-both, barrier /
    boundary rule), factored out for reuse by astar_multigoal_multimode.
    astar_multigoal itself keeps its own inlined copy and is left unchanged."""
    elev_cur = elevation[cr, cc]
    elev_n = elevation[nr, nc]
    if math.isnan(elev_cur) or math.isnan(elev_n):
        return INF
    dlat = dr * cell_size_lat_m
    dlon = dc * cell_size_lon_m
    dist = math.sqrt(dlat * dlat + dlon * dlon)
    signed_grade = (elev_n - elev_cur) / dist
    overshoot = abs(signed_grade) - max_grade
    slope_penalty = 1.0
    if overshoot > 0.0:
        slope_penalty = math.exp(overshoot * SLOPE_PENALTY_SCALE)
        if slope_penalty > SLOPE_PENALTY_CAP:
            return INF
    spd = _speed_kmh(signed_grade, speed_function_id, base_speed_kmh, max_grade)
    if spd <= 1e-9:
        return INF
    base_time = dist * 3.6 / spd
    base_time *= slope_penalty

    tv_cur = trail_grid[cr, cc]
    tv_n = trail_grid[nr, nc]
    if tv_cur > 0 or tv_n > 0:
        # Trail-takes-both: pick the lower-friction trail cell.
        fc = trail_friction_lookup[tv_cur] if tv_cur > 0 else INF
        fn = trail_friction_lookup[tv_n] if tv_n > 0 else INF
        tf = fc if fc < fn else fn
        if not (tf < INF):
            return INF  # impassable trail for this mode
        edge = base_time * tf
    else:
        mc = cost_mult[cr, cc]
        mn = cost_mult[nr, nc]
        if (not (mc < INF)) or (not (mn < INF)):
            return INF  # impassable terrain (incl. wilderness)
        edge = base_time * 0.5 * (mc + mn)

    if boundary_mode_id == 0:  # strict
        if barrier_grid[cr, cc] == 255 or barrier_grid[nr, nc] == 255:
            return INF
    elif boundary_mode_id == 1:  # pragmatic
        if barrier_grid[cr, cc] == 255 or barrier_grid[nr, nc] == 255:
            edge *= 5.0
    # emergency (2): ignore barriers
    return edge


@njit(cache=True)
def astar_multigoal_multimode(
    cost_mult_stack,        # 3D float64 [rows, cols, n_modes]: per-mode context mult (inf=impassable)
    elevation,              # 2D float64: metres (NaN = impassable)
    cell_size_lat_m,        # float
    cell_size_lon_m,        # float
    max_grade_arr,          # 1D float64 [n_modes]: tan(max_slope) per mode
    speed_function_ids,     # 1D int [n_modes]: 0=tobler 1=herzog 2=linear
    base_speed_kmh_arr,     # 1D float64 [n_modes]
    trail_grid,             # 2D uint8: 0=none else trail value (5/15/25)
    trail_friction_stack,   # 2D float64 [n_modes, 256]: friction by trail value per mode
    barrier_grid,           # 2D uint8: 255=barrier
    boundary_mode_id,       # int: 0=strict 1=pragmatic 2=emergency
    origin_row, origin_col,
    origin_modes,           # 1D int: allowed start modes (seeds)
    goal_rows, goal_cols,   # 1D int arrays
    goal_modes,             # 1D int: allowed end modes
    trans_rows,             # 1D int [n_trans]: transition cell rows
    trans_cols,             # 1D int [n_trans]: transition cell cols
    trans_from_mode,        # 1D int [n_trans]: source mode index
    trans_to_mode,          # 1D int [n_trans]: target mode index
    trans_cost_s,           # 1D float64 [n_trans]: transition penalty seconds
    disable_heuristic=False,  # tests only: h≡0 turns the search into Dijkstra (admissibility oracle)
):
    """A* over (row, col, mode). The first (goal cell, allowed goal mode) state
    popped wins; optimal under the per-mode admissible heuristic (§10). Returns
    (best_goal_idx, path, total_cost) where path is int64 (N,3) of (row,col,mode)
    from an origin-mode seed to the goal. (-1, empty, inf) if unreachable."""
    rows = elevation.shape[0]
    cols = elevation.shape[1]
    n_modes = cost_mult_stack.shape[2]
    rc = rows * cols  # cells per mode-plane; heap id = mode*rc + row*cols + col (§11)

    goal_index = np.full((rows, cols), -1, dtype=np.int64)
    for gi in range(goal_rows.shape[0]):
        goal_index[goal_rows[gi], goal_cols[gi]] = gi
    goal_mode_ok = np.zeros(n_modes, dtype=np.bool_)
    for gi in range(goal_modes.shape[0]):
        goal_mode_ok[goal_modes[gi]] = True

    # §10: divide straight-line distance by the FASTEST base speed over goal modes
    # -> smallest possible finishing time -> admissible lower bound. Independent of
    # the state's current mode (a slow-mode state may switch to a fast mode later).
    max_goal_speed = 0.0
    for gi in range(goal_modes.shape[0]):
        s = base_speed_kmh_arr[goal_modes[gi]]
        if s > max_goal_speed:
            max_goal_speed = s

    g_score = np.full((rows, cols, n_modes), INF, dtype=np.float64)
    parent = np.full((rows, cols, n_modes), -1, dtype=np.int64)  # parent's packed heap id
    closed = np.zeros((rows, cols, n_modes), dtype=np.bool_)

    # Per-cell transition index, built once before the loop. Sort transitions by
    # packed cell key so each cell's edges are contiguous, then trans_head/trans_cnt
    # give O(1) lookup -- a CSR layout, no numba-typed dict (compiles in nopython).
    n_trans = trans_rows.shape[0]
    trans_head = np.full((rows, cols), -1, dtype=np.int64)
    trans_cnt = np.zeros((rows, cols), dtype=np.int64)
    s_rows = trans_rows
    s_cols = trans_cols
    s_from = trans_from_mode
    s_to = trans_to_mode
    s_cost = trans_cost_s
    if n_trans > 0:
        key = np.empty(n_trans, dtype=np.int64)
        for t in range(n_trans):
            key[t] = trans_rows[t] * cols + trans_cols[t]
        order = np.argsort(key)
        s_rows = trans_rows[order]
        s_cols = trans_cols[order]
        s_from = trans_from_mode[order]
        s_to = trans_to_mode[order]
        s_cost = trans_cost_s[order]
        for t in range(n_trans):
            r = s_rows[t]
            c = s_cols[t]
            if trans_head[r, c] == -1:
                trans_head[r, c] = t
            trans_cnt[r, c] += 1

    # Binary min-heap (lazy deletion). Capacity covers re-pushes from movement +
    # transition relaxations across the n_modes-fold state space.
    cap = rc * n_modes * 8
    if cap < 1024:
        cap = 1024
    heap_id = np.empty(cap, dtype=np.int64)
    heap_f = np.empty(cap, dtype=np.float64)
    hsize = 0

    def heuristic(r, c):
        if disable_heuristic:
            return 0.0
        best = INF
        for gi in range(goal_rows.shape[0]):
            dr = (r - goal_rows[gi]) * cell_size_lat_m
            dc = (c - goal_cols[gi]) * cell_size_lon_m
            d = math.sqrt(dr * dr + dc * dc)
            if d < best:
                best = d
        return best * 3.6 / max_goal_speed  # metres -> seconds at fastest goal speed

    # Seed every allowed origin mode at the origin cell.
    for oi in range(origin_modes.shape[0]):
        m0 = origin_modes[oi]
        g_score[origin_row, origin_col, m0] = 0.0
        heap_id[hsize] = m0 * rc + origin_row * cols + origin_col
        heap_f[hsize] = heuristic(origin_row, origin_col)
        hsize += 1

    while hsize > 0:
        # Pop min.
        cur_id = heap_id[0]
        hsize -= 1
        heap_id[0] = heap_id[hsize]
        heap_f[0] = heap_f[hsize]
        i = 0
        while True:
            l = 2 * i + 1
            r2 = 2 * i + 2
            sm = i
            if l < hsize and heap_f[l] < heap_f[sm]:
                sm = l
            if r2 < hsize and heap_f[r2] < heap_f[sm]:
                sm = r2
            if sm != i:
                tid = heap_id[i]; heap_id[i] = heap_id[sm]; heap_id[sm] = tid
                tf = heap_f[i]; heap_f[i] = heap_f[sm]; heap_f[sm] = tf
                i = sm
            else:
                break

        m = cur_id // rc
        rem = cur_id % rc
        cr = rem // cols
        cc = rem % cols
        if closed[cr, cc, m]:
            continue  # stale heap entry
        closed[cr, cc, m] = True

        if goal_index[cr, cc] >= 0 and goal_mode_ok[m]:
            # First (goal cell, allowed goal mode) popped is optimal -- trace back.
            length = 1
            node = cur_id
            pm = node // rc; prem = node % rc; pr = prem // cols; pc = prem % cols
            while parent[pr, pc, pm] != -1:
                length += 1
                node = parent[pr, pc, pm]
                pm = node // rc; prem = node % rc; pr = prem // cols; pc = prem % cols
            path = np.empty((length, 3), dtype=np.int64)
            node = cur_id
            k = length - 1
            while node != -1:
                pm = node // rc; prem = node % rc; pr = prem // cols; pc = prem % cols
                path[k, 0] = pr
                path[k, 1] = pc
                path[k, 2] = pm
                k -= 1
                node = parent[pr, pc, pm]
            return goal_index[cr, cc], path, g_score[cr, cc, m]

        g_cur = g_score[cr, cc, m]
        if math.isnan(elevation[cr, cc]):
            continue

        cm = cost_mult_stack[:, :, m]
        tfl = trail_friction_stack[m]
        mg = max_grade_arr[m]
        sfid = speed_function_ids[m]
        bspd = base_speed_kmh_arr[m]

        # Movement edges: 8-neighbour grid step in the SAME mode.
        for dr in range(-1, 2):
            for dc in range(-1, 2):
                if dr == 0 and dc == 0:
                    continue
                nr = cr + dr
                nc = cc + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                    continue
                if closed[nr, nc, m]:
                    continue
                edge = _movement_edge_time(
                    cr, cc, nr, nc, dr, dc,
                    elevation, cm, trail_grid, tfl,
                    barrier_grid, boundary_mode_id,
                    cell_size_lat_m, cell_size_lon_m, mg, sfid, bspd)
                if not (edge < INF):
                    continue
                tentative = g_cur + edge
                if tentative < g_score[nr, nc, m]:
                    g_score[nr, nc, m] = tentative
                    parent[nr, nc, m] = cur_id
                    f = tentative + heuristic(nr, nc)
                    if hsize < cap:
                        heap_id[hsize] = m * rc + nr * cols + nc
                        heap_f[hsize] = f
                        j = hsize
                        hsize += 1
                        while j > 0:
                            par = (j - 1) // 2
                            if heap_f[j] < heap_f[par]:
                                tid = heap_id[j]; heap_id[j] = heap_id[par]; heap_id[par] = tid
                                tf2 = heap_f[j]; heap_f[j] = heap_f[par]; heap_f[par] = tf2
                                j = par
                            else:
                                break

        # Transition edges: same cell, mode change m -> to_m (flat penalty, no terrain).
        if n_trans > 0 and trans_head[cr, cc] != -1:
            base = trans_head[cr, cc]
            cnt = trans_cnt[cr, cc]
            for t in range(base, base + cnt):
                if s_from[t] != m:
                    continue
                to_m = s_to[t]
                if closed[cr, cc, to_m]:
                    continue
                tentative = g_cur + s_cost[t]
                if tentative < g_score[cr, cc, to_m]:
                    g_score[cr, cc, to_m] = tentative
                    parent[cr, cc, to_m] = cur_id
                    f = tentative + heuristic(cr, cc)
                    if hsize < cap:
                        heap_id[hsize] = to_m * rc + cr * cols + cc
                        heap_f[hsize] = f
                        j = hsize
                        hsize += 1
                        while j > 0:
                            par = (j - 1) // 2
                            if heap_f[j] < heap_f[par]:
                                tid = heap_id[j]; heap_id[j] = heap_id[par]; heap_id[par] = tid
                                tf2 = heap_f[j]; heap_f[j] = heap_f[par]; heap_f[par] = tf2
                                j = par
                            else:
                                break

    return -1, np.empty((0, 3), dtype=np.int64), INF
