"""Numba-jit anisotropic A* for wilderness pathfinding (replaces MCP_Geometric).

Single-mode, multi-goal least-time pathfinder over a raster grid. Unlike the old
isotropic MCP, the per-edge time is anisotropic: it depends on the *signed* slope
between the two cells (climbing != descending) via the mode's speed function
(signed Tobler / Herzog / linear), the average per-cell context multiplier of the
two endpoints (or the trail friction when either endpoint is on a trail), and a
barrier/boundary rule. The first goal cell popped from the open set wins, which is
optimal under the admissible heuristic (straight-line distance / base speed).

Cliffs (|grade| > max_grade) are a hard wall here; smoothing is deferred to #19.
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
                if abs(signed_grade) > max_grade:
                    continue  # hard cliff
                spd = _speed_kmh(signed_grade, speed_function_id, base_speed_kmh, max_grade)
                if spd <= 1e-9:
                    continue
                base_time = dist * 3.6 / spd

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
