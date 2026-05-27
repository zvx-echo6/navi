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
import hashlib
import heapq
import itertools
import math
import sqlite3
from collections import defaultdict

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

    # §10: divide straight-line distance by the FASTEST EFFECTIVE speed over goal modes
    # -> smallest possible finishing time -> admissible lower bound. Independent of the
    # state's current mode (a slow-mode state may switch to a fast mode later).
    max_goal_speed = 0.0
    for gi in range(goal_modes.shape[0]):
        s = base_speed_kmh_arr[goal_modes[gi]]
        if s > max_goal_speed:
            max_goal_speed = s
    # An edge's time is base_time * factor, where the factor is the trail friction (on a
    # trail) or the avg context multiplier (off-trail); effective speed = base / factor. So
    # distance/base_speed alone OVERESTIMATES remaining cost wherever some factor < 1.0 (a
    # road's 0.1 friction is ~10x faster) -> inadmissible. Bound instead by base speed /
    # the SMALLEST factor reachable by any goal mode, over BOTH trail friction and the
    # context multiplier (network_affinity can scale trail friction above the off-trail
    # multiplier, so trail friction alone is not always the fastest surface).
    min_factor = INF
    for gi in range(goal_modes.shape[0]):
        gm = goal_modes[gi]
        for v in range(256):
            f = trail_friction_stack[gm, v]
            if f < min_factor:
                min_factor = f
        for rr in range(rows):
            for cc in range(cols):
                cmv = cost_mult_stack[rr, cc, gm]
                if cmv < min_factor:
                    min_factor = cmv
    if not (min_factor < INF):
        min_factor = 1.0
    if min_factor < 1e-6:
        min_factor = 1e-6
    max_effective_speed = max_goal_speed / min_factor

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
        return best * 3.6 / max_effective_speed  # metres -> s at fastest effective speed (§10)

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


# ═══════════════════════════════════════════════════════════════════════════════
# HPA* TWO-LEVEL RUNTIME (unified-graph perf, HPA-SPEC.md §8/§9, Phase H3)
# ═══════════════════════════════════════════════════════════════════════════════
#
# astar_hpa_multimode is a PURE-PYTHON sibling of astar_multigoal_multimode (NOT @njit:
# it does SQLite I/O + per-chunk Python loops). It searches the precomputed abstract chunk
# graph (cost tiles from hpa_build), then refines each hop with the existing @njit
# astar_multigoal on that chunk's live cost layer. astar_multigoal / astar_multigoal_multimode
# are byte-unchanged; HPA* engages only when the dispatcher passes a tile DB.
#
# v1 limitations (HPA-SPEC.md §5/§8, PR #44): border entrances ONLY (no transition-cell
# entrances ≥20), so there are NO mode-switch edges -> the abstract path is SINGLE-MODE
# (a mode m in start_modes ∩ goal_modes). A route whose optimum needs a mode switch (the §1
# wilderness→home walk-then-drive) will here degrade to single-mode or find no path; the
# dispatcher then falls back to astar_multigoal_multimode. **This means enabling HPA* on a
# mixed-mode route can return a worse selected_mode_set than unified A* — keep disabled in
# prod until transition-cell entrances land (a follow-up) or H5 gates it.**
# The abstract search uses Dijkstra (h≡0, trivially admissible/optimal); the abstract graph
# is tiny, so a §10-style heuristic isn't needed for v1.

HPA_BORDER_ENTRANCES = 20


def _hpa_profile_hash():
    from .cost import MODE_PROFILES
    return hashlib.sha256(repr(MODE_PROFILES).encode()).hexdigest()


def _hpa_coverage_reason(conn, needed_chunks, boundary_mode, network_affinity):
    """Return a fallback reason string (HPA cannot/should-not engage), or None if clear.
    Order: config gates first (cheap), then freshness, then tile coverage."""
    if boundary_mode != "pragmatic":
        return "boundary_mode"
    if network_affinity and any(float(v) != 1.0 for v in network_affinity.values()):
        return "affinity"
    row = conn.execute("SELECT value FROM meta WHERE key='mode_profile_hash'").fetchone()
    if not row or row[0] != _hpa_profile_hash():
        return "stale_profile"
    cxs = [c[0] for c in needed_chunks]
    cys = [c[1] for c in needed_chunks]
    present = {(r[0], r[1]) for r in conn.execute(
        "SELECT DISTINCT chunk_x, chunk_y FROM chunk_costs "
        "WHERE chunk_x BETWEEN ? AND ? AND chunk_y BETWEEN ? AND ?",
        (min(cxs), max(cxs), min(cys), max(cys)))}
    if any(ch not in present for ch in needed_chunks):
        return "missing_chunk"
    return None


def _hpa_abstract_search(conn, needed_chunks, relevant_modes, start_edges, goal_edges):
    """Dijkstra over the abstract graph. Nodes are (cx, cy, entrance, mode) plus virtual
    "START"/"GOAL". Edges: intra-chunk (precomputed tile costs), inter-chunk seams (free,
    same physical border cell), and the start/goal pseudo-edges. Returns
    (node_seq_excl_endpoints, total_cost) or (None, INF). v1: no cross-mode edges."""
    present = set(needed_chunks)
    rmodes = set(relevant_modes)
    cxs = [c[0] for c in needed_chunks]
    cys = [c[1] for c in needed_chunks]
    adj = defaultdict(list)
    # Intra-chunk directed edges (border entrances 0..19 only — transition cells deferred).
    for cx, cy, m, fe, te, cost in conn.execute(
            "SELECT chunk_x, chunk_y, mode_idx, from_entrance, to_entrance, cost_s FROM chunk_costs "
            "WHERE chunk_x BETWEEN ? AND ? AND chunk_y BETWEEN ? AND ?",
            (min(cxs), max(cxs), min(cys), max(cys))):
        if m in rmodes and fe < HPA_BORDER_ENTRANCES and te < HPA_BORDER_ENTRANCES:
            adj[(cx, cy, fe, m)].append(((cx, cy, te, m), float(cost)))
    # Inter-chunk seams (free, both directions). Right 5..9 ↔ left 15..19 of (cx+1,cy);
    # bottom 10..14 ↔ top 0..4 of (cx,cy+1) — same fraction, same physical cell (spec §8).
    for (cx, cy) in needed_chunks:
        for m in rmodes:
            if (cx + 1, cy) in present:
                for k in range(5):
                    a, b = (cx, cy, 5 + k, m), (cx + 1, cy, 15 + k, m)
                    adj[a].append((b, 0.0)); adj[b].append((a, 0.0))
            if (cx, cy + 1) in present:
                for k in range(5):
                    a, b = (cx, cy, 10 + k, m), (cx, cy + 1, k, m)
                    adj[a].append((b, 0.0)); adj[b].append((a, 0.0))
    for node, cost in start_edges.items():
        adj["START"].append((node, float(cost)))
    for node, cost in goal_edges.items():
        adj[node].append(("GOAL", float(cost)))

    counter = itertools.count()
    dist = {"START": 0.0}
    prev = {}
    pq = [(0.0, next(counter), "START")]
    while pq:
        d, _, u = heapq.heappop(pq)
        if u == "GOAL":
            break
        if d > dist.get(u, INF):
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, INF):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, next(counter), v))
    if "GOAL" not in dist:
        return None, INF
    seq, node = [], "GOAL"
    while node != "START":
        if node != "GOAL":
            seq.append(node)
        node = prev[node]
    seq.reverse()
    return seq, dist["GOAL"]


def _hpa_inchunk(layer, fr, fc, gr, gc):
    """Least-time path + cost between two cells of a chunk's live cost layer (single mode)."""
    _, path, cost = astar_multigoal(
        layer["cost_mult"], layer["elevation"], layer["cell_size_m"], layer["cell_size_m"],
        layer["max_grade"], layer["speed_function_id"], layer["base_speed_kmh"],
        layer["trail_grid"], layer["trail_friction_lookup"], layer["barrier_grid"], 1,
        int(fr), int(fc), np.array([gr], dtype=np.int64), np.array([gc], dtype=np.int64))
    return path, cost


def _hpa_emit(layer, path, mode, dem_reader, full_meta, out):
    """Append a chunk-local cell path to `out` as (full_row, full_col, mode), via lat/lon
    (chunk grid -> full-bbox grid) since the chunk fetch and full fetch have different pixel
    origins. Consecutive duplicates (e.g. at seams) are dropped."""
    for k in range(path.shape[0]):
        lat, lon = dem_reader.pixel_to_latlon(int(path[k, 0]), int(path[k, 1]), layer["meta"])
        r, c = dem_reader.latlon_to_pixel(lat, lon, full_meta)
        node = (int(r), int(c), int(mode))
        if not out or out[-1] != node:
            out.append(node)


def astar_hpa_multimode(tile_db_path, full_meta, start_lat, start_lon, end_lat, end_lon,
                        origin_modes, goal_modes, boundary_mode, network_affinity,
                        chunk_layer=None, dem_reader=None):
    """Two-level HPA* (HPA-SPEC.md §8). Returns (idx, path_Nx3_int64, total_cost, reason)
    matching astar_multigoal_multimode's render contract: idx==0 on success (reason None),
    idx==-1 on fallback (reason in {boundary_mode, affinity, stale_profile, missing_chunk,
    no_abstract_path, refine_failed}). chunk_layer(cx, cy, mode_idx)->layer dict (live,
    native-30m, tile-grid-aligned) is supplied by the dispatcher for refinement."""
    from . import hpa_build as hb
    empty = np.empty((0, 3), dtype=np.int64)
    south, north, west, east = full_meta["bounds"]
    needed = hb.chunks_in_bbox(south, west, north, east)

    conn = sqlite3.connect(f"file:{tile_db_path}?mode=ro", uri=True)
    try:
        reason = _hpa_coverage_reason(conn, needed, boundary_mode, network_affinity)
        if reason is not None:
            return -1, empty, INF, reason
        relevant = sorted(set(int(x) for x in origin_modes) & set(int(x) for x in goal_modes))
        if not relevant:
            return -1, empty, INF, "no_abstract_path"

        start_chunk = hb.chunk_coords(start_lat, start_lon)
        goal_chunk = hb.chunk_coords(end_lat, end_lon)

        # Same chunk: a direct in-chunk A* beats routing out to a border entrance and back.
        if start_chunk == goal_chunk:
            best = None
            for m in relevant:
                L = chunk_layer(start_chunk[0], start_chunk[1], m)
                sr, sc = dem_reader.latlon_to_pixel(start_lat, start_lon, L["meta"])
                gr, gc = dem_reader.latlon_to_pixel(end_lat, end_lon, L["meta"])
                path, cost = _hpa_inchunk(L, sr, sc, gr, gc)
                if np.isfinite(cost) and (best is None or cost < best[0]):
                    best = (cost, L, path, m)
            if best is None:
                return -1, empty, INF, "no_abstract_path"
            out = []
            _hpa_emit(best[1], best[2], best[3], dem_reader, full_meta, out)
            return (0, np.array(out, dtype=np.int64), best[0], None) if len(out) >= 2 \
                else (-1, empty, INF, "refine_failed")

        # Pseudo-edges: start cell -> each start-chunk entrance; each goal-chunk entrance -> end.
        start_edges, goal_edges = {}, {}
        for m in relevant:
            Ls = chunk_layer(start_chunk[0], start_chunk[1], m)
            sr, sc = dem_reader.latlon_to_pixel(start_lat, start_lon, Ls["meta"])
            for ei, (er, ec) in enumerate(Ls["entrance_cells"]):
                _, cost = _hpa_inchunk(Ls, sr, sc, er, ec)
                if np.isfinite(cost):
                    start_edges[(start_chunk[0], start_chunk[1], ei, m)] = cost
            Lg = chunk_layer(goal_chunk[0], goal_chunk[1], m)
            gr, gc = dem_reader.latlon_to_pixel(end_lat, end_lon, Lg["meta"])
            for ei, (er, ec) in enumerate(Lg["entrance_cells"]):
                _, cost = _hpa_inchunk(Lg, er, ec, gr, gc)
                if np.isfinite(cost):
                    goal_edges[(goal_chunk[0], goal_chunk[1], ei, m)] = cost

        seq, cost = _hpa_abstract_search(conn, needed, relevant, start_edges, goal_edges)
        if seq is None:
            return -1, empty, INF, "no_abstract_path"
    finally:
        conn.close()

    # Refinement: stitch the real cells for each hop. Single mode throughout (v1).
    m = seq[0][3]
    out = []
    Ls = chunk_layer(start_chunk[0], start_chunk[1], m)
    sr, sc = dem_reader.latlon_to_pixel(start_lat, start_lon, Ls["meta"])
    fr, fc = Ls["entrance_cells"][seq[0][2]]
    path, c = _hpa_inchunk(Ls, sr, sc, fr, fc)
    if not np.isfinite(c):
        return -1, np.empty((0, 3), dtype=np.int64), INF, "refine_failed"
    _hpa_emit(Ls, path, m, dem_reader, full_meta, out)
    for a, b in zip(seq, seq[1:]):
        if a[0] == b[0] and a[1] == b[1]:          # intra-chunk hop -> refine
            L = chunk_layer(a[0], a[1], a[3])
            ar, ac = L["entrance_cells"][a[2]]
            br, bc = L["entrance_cells"][b[2]]
            path, c = _hpa_inchunk(L, ar, ac, br, bc)
            if not np.isfinite(c):
                return -1, np.empty((0, 3), dtype=np.int64), INF, "refine_failed"
            _hpa_emit(L, path, m, dem_reader, full_meta, out)
        # else: inter-chunk seam (same physical cell) -> no refinement
    Lg = chunk_layer(goal_chunk[0], goal_chunk[1], m)
    lr, lc = Lg["entrance_cells"][seq[-1][2]]
    gr, gc = dem_reader.latlon_to_pixel(end_lat, end_lon, Lg["meta"])
    path, c = _hpa_inchunk(Lg, lr, lc, gr, gc)
    if not np.isfinite(c):
        return -1, np.empty((0, 3), dtype=np.int64), INF, "refine_failed"
    _hpa_emit(Lg, path, m, dem_reader, full_meta, out)
    if len(out) < 2:
        return -1, np.empty((0, 3), dtype=np.int64), INF, "refine_failed"
    return 0, np.array(out, dtype=np.int64), cost, None
