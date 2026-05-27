# Hierarchical Pathfinding (HPA*) — Architecture Spec

**Status:** Phase H1 of 5 — design only, no code.
**Scope:** This document specifies a two-level hierarchical-pathfinding (HPA*) accelerator
for `navi_offroute` Auto routing. It is an *additive* fast path layered on top of the
unified-graph search shipped in PRs #37–#42; the existing `astar_multigoal_multimode`
kernel and the whole `_route_auto` flow remain in place as the fallback. HPA* is engaged
only where precomputed cost tiles cover the route.

Baseline: HEAD `8d2ee9b` (Phase 4.5 — corridor mask + parallel cost layers). Phases 1–5
+ 4.5 of the unified-graph refactor are live on VM 1130.

---

## 1. Problem statement

The unified-graph search is correct (the §1 wilderness→home walk-then-drive case resolves),
but query latency on long wilderness routes hits a floor set by A* state-space size.

**Phase-4.5 live smoke numbers (VM 1130, HEAD `8d2ee9b`):**

| Route | distance | wall-clock | kernel (journal) |
|---|---|---|---|
| A — in-town | 1.19 km | ~7 s | 0.13 s |
| **B — Sawtooth → Twin Falls** | **205 km** | **34.6 s** | **10.75 s** |
| C — off-path | 9.57 km | ~7 s | 0.04 s |

Route B is the motivating case: 34.6 s wall, **10.75 s kernel**. (Phase 4.5's corridor mask
already cut the kernel 2.7× from the Phase-4 28.85 s; the remaining ~24 s of Route B's wall
is non-kernel raster/MVUM IO, addressed separately. This spec targets the kernel floor.)

**Why kernel time scales with bbox area in plain A*.** The unified search runs over a
`(row, col, mode)` state space whose size is `rows × cols × n_modes`. `rows × cols` is the
DEM bbox area in cells; for a 205 km route the axis-aligned bbox is large (the corridor mask
makes most cells impassable but the array is still allocated and the open set still expands
across the passable corridor band). A* expansions grow roughly linearly with the number of
reachable cells, which grows with bbox **area**. Doubling route length roughly quadruples the
bbox area and the kernel work. The unified-graph spec §16 risk register already flagged this:

> "**4× state-space explosion** — `(row, col, mode)` is ~4× the single-mode search; heap +
> arrays grow, latency risk on large bbox."

The corridor mask (Phase 4.5) trims the *lateral* extent but not the *along-route* length, so
long routes still pay O(length) cells × 4 modes. HPA* removes the length dependence from the
query-time search by precomputing per-chunk costs offline.

**DEM downsampling is OFF THE TABLE.** A tempting alternative — coarsen the DEM for long
routes — is rejected for off-trail wilderness routing on safety grounds. Research finding: a
60 m DEM smooths a 10 m cliff from ~33% grade down to ~17% — fully walkable under *every*
mode profile (`max_slope_deg` ≥ 20° everywhere) — and any sub-cell-width ravine is
mathematically guaranteed to disappear when the cell is wider than the ravine. A downsampled
grid would route people over cliffs and across invisible ravines. HPA* keeps the **native
30 m** resolution everywhere (chunk-internal A* runs on the real cost grid); only the
*search hierarchy* is abstracted, never the terrain.

---

## 2. HPA* in plain English

Plain A* treats every 30 m cell as a graph node and explores outward cell-by-cell. HPA*
adds a second, coarser level:

1. **Partition** the grid into fixed square **chunks** (50×50 cells ≈ 1.5 km).
2. **Offline**, for each chunk and each mode, precompute the least-time cost between every
   pair of **entrance cells** on the chunk's border (a small A* search confined to the
   chunk). Store just the scalar costs.
3. **At query time**, search an **abstract graph** whose nodes are
   `(chunk, entrance, mode)` and whose edges are (a) the precomputed chunk-internal costs and
   (b) the free/mode-switch transitions across chunk borders. This graph is tiny.
4. **Refine**: for each chunk the abstract path visits, run a small A* inside that chunk to
   recover the actual cell sequence for rendering.

The query-time search visits **chunks**, not cells, so its cost scales with route length in
*chunks*, not *cells*.

**Worked example — Sawtooth → Twin Falls (Route B, 205 km).**
- Plain A* today: the corridor band over a ~205 km × ~20 km area at 30 m is on the order of
  ~2M reachable cells × 4 modes — the 10.75 s kernel.
- HPA*: at 1.5 km/chunk a 205 km route crosses **~30 chunks** along its length (≈137 chunks
  total in the corridor band, but the abstract A* only expands those on or near the optimal
  chunk sequence). The high-level search visits **~30 chunks** — each contributing at most
  20 entrance nodes × 4 modes — instead of ~2M cells. The per-chunk refinement A* runs over
  2,500 cells each, only for chunks actually on the final path (~30 small fast searches).

The abstract search is three to four orders of magnitude smaller than the cell-level search.

---

## 3. Chunk grid definition

- **Chunk size:** 50×50 DEM cells = **1.5 km × 1.5 km** at our native 30 m resolution.
- **Alignment to the DEM tile grid.** The DEM is `planet-dem.pmtiles` at Z12, 512-pixel
  tiles. At 30 m/cell the imagery is ~2 cells/pixel, giving **256 cells per tile edge**.
  256 / 50 is not integer; we therefore define chunk size so that **one Z12 tile = exactly
  5×5 chunks** (≈25 chunks/tile, 256/5 ≈ 51-cell chunks — round to a fixed 50 with the tile
  edge as the alignment anchor, not the chunk count). The chunk grid origin is pinned to the
  tile grid so every chunk lies wholly inside one tile's raster footprint.
- **Why alignment matters (I/O sympathy).** Because each chunk is fully contained in a single
  Z12 tile, the build pipeline reads each DEM tile **once** and carves its 25 chunks from the
  in-memory raster — no chunk straddles a tile boundary, so there is no read amplification and
  no cross-tile stitching at build time. Friction/trails/wilderness/MVUM readers are queried
  per chunk bbox, which falls inside one tile footprint, keeping their reads local too.
- **Chunk coordinates.** `chunk_x`, `chunk_y` are integer indices on a global grid whose
  origin is **pinned at lat = 0, lon = 0**, stepping by the 1.5 km chunk size in the local
  equirectangular projection used by the readers. Pinning the origin to (0, 0) modulo the
  chunk size makes chunk identity **deterministic across rebuilds and DEM regrids** (see §13).

---

## 4. Entrance cells

Per HPA* (Botea, Müller & Schaeffer 2004), chunk borders are **sparsified** into a small set
of entrance cells rather than pairing every border cell.

- **5 entrances per edge × 4 edges = 20 entrances per chunk.** Corners are shared between
  adjacent edges/chunks.
- **Index convention (fixed, for tile-format determinism):**

  ```
  0..4   = top    edge (left → right)
  5..9   = right  edge (top → bottom)
  10..14 = bottom edge (left → right)
  15..19 = left   edge (top → bottom)
  20+    = transition cells (§5), appended in a deterministic order
  ```

  The 5 entrances on each edge are evenly spaced (cells at the 1/6, 2/6, 3/6, 4/6, 5/6
  fractions of the edge, or the edge-specific convention the build commits to and records in
  `meta`). Both the builder and the runtime MUST use this exact convention so stored
  `from_entrance`/`to_entrance` indices are portable.
- **Sparsification rationale.** A 50×50 chunk has 196 border cells. Pairing all of them is
  196 × 196 ≈ **38K pairs per chunk per mode**. The 5-per-edge sparsification is
  20 × 20 = **400 pairs** — a ~95× reduction in stored rows and build-time searches, at the
  cost of bounded suboptimality (§13: H5 measures it; tune entrance count up if >5%).

---

## 5. Mode-switching transitions × chunks

The existing transition cells from `transitions.py` (parking lots, trailheads, road termini,
surface-change boundaries) must remain reachable in the abstract graph.

- **Rule:** a transition cell becomes an **additional entrance** of its chunk, regardless of
  whether it sits on a border or in the chunk interior. It is assigned an entrance index
  `≥ 20` (after the 20 fixed border entrances), in a deterministic order recorded at build
  time.
- The chunk's stored cost table therefore includes paths **to and from** that transition cell
  (transition entrance ↔ each border entrance, and transition ↔ transition within the chunk).
- **At runtime**, the two-level A* treats the mode-switch edge exactly as
  `astar_multigoal_multimode` does today: a same-cell `(r, c, m) → (r, c, m')` edge carrying
  the flat per-type time penalty (parking 60 s, trailhead 30 s, road-terminus 60 s,
  surface-change 0 s), allowed only at that transition entrance. The abstract graph gains a
  zero-distance mode-change edge between the two mode planes at that entrance node.
- **Border-straddling transitions.** A transition cell on (or adjacent to) a chunk boundary is
  added as an entrance to **both** neighbouring chunks (overlap), so a mode switch right at a
  border is reachable from either side (§13 mitigation).

---

## 6. Cost-only storage format

One SQLite database **per region** at `/mnt/nav/hpa/<region>.db` (e.g.
`/mnt/nav/hpa/idaho.db`). We store **only scalar costs**, never cell paths — paths are
re-derived by the refinement step (§8).

```sql
CREATE TABLE chunk_costs (
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  mode_idx INTEGER NOT NULL,       -- 0=foot, 1=2w, 2=4w, 3=vehicle
  from_entrance INTEGER NOT NULL,  -- 0..19 border entrances, or 20+ for transition cells
  to_entrance INTEGER NOT NULL,
  cost_s REAL NOT NULL,
  PRIMARY KEY (chunk_x, chunk_y, mode_idx, from_entrance, to_entrance)
);
CREATE INDEX idx_chunk_mode ON chunk_costs (chunk_x, chunk_y, mode_idx);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- build provenance, mode_profile_hash, etc
```

- `cost_s` is the least-time (seconds) for that mode between the two entrances, INF-pruned
  (impassable pairs are simply absent — a missing row means "no within-chunk path for this
  mode"). `mode_idx` matches the fixed `{foot:0, 2w:1, 4w:2, vehicle:3}` ordering used by
  `astar_multigoal_multimode` and `MODE_INDEX` in `transitions.py`.
- The `meta` table carries build provenance: `mode_profile_hash` (a hash of `MODE_PROFILES`
  so a profile change invalidates the tiles — §13), DEM version, chunk size, entrance
  convention, region boundary polygon/bbox, and build timestamp/commit.
- **Idaho-size estimate:** ~96K chunks × 400 entrance pairs × 4 modes × ~50 bytes/row
  ≈ **~1.5 GB SQLite**. (Sparse: impassable pairs absent, so the real file is smaller.) This
  confirms the storage analysis already approved. `/mnt/nav/hpa/<region>.db` lives on the same
  fast virtiofs (host NVMe) as the DEM and the other readers — local-disk speed, not network.

---

## 7. Build pipeline (Phase H2 — NOT in this PR)

New standalone CLI module `backend/services/navi_offroute/hpa_build.py`. **No router wiring.**

- **Inputs:** region geometry (state bbox + buffer), and the *same* readers used at
  runtime — DEM, friction, trails, wilderness, MVUM. No new IO dependencies.
- **Per chunk:** fetch the chunk's rasters via the existing readers (one DEM-tile read serves
  25 chunks — §3), build the per-mode cost layers the same way the runtime does
  (`compute_cost_multiplier_grid` + inflate, with MVUM closures baked in), then run
  `20 × 20 × 4 = 1,600` small single-mode A* searches via the existing `astar_multigoal`
  (entrance → all other entrances, per mode). Transition-cell entrances (§5) add a few more.
- **Output:** rows inserted into `chunk_costs`; `meta` populated once per build.
- **Parallelism:** embarrassingly parallel across chunks (each chunk is independent). Build
  time ≈ **15 min on 16 cores** for an Idaho-sized region (96K chunks × ~160 ms/chunk / 16).
- Reuses `astar_multigoal` (single-mode) unchanged — the builder needs no multimode kernel.

---

## 8. Two-level runtime A*

**Decision: a NEW kernel `astar_hpa_multimode`**, sibling to `astar_multigoal_multimode`
(not a flag on the existing kernel). This keeps `astar_multigoal_multimode` byte-stable as
the fallback and avoids branching a hot `@njit` loop on a tile handle (SQLite access can't
live inside `nopython` anyway; the abstract search is plain Python/numpy reading from the DB).

- **Inputs:** the same per-mode cost layers / transition cells as
  `astar_multigoal_multimode`, **plus** a handle (read-only connection) to the region's
  cost-tile SQLite.
- **Step 1 — chunk coverage.** Identify which chunks the route bbox covers (deterministic
  chunk coords, §3). Query `chunk_costs`/`meta` for those chunks.
- **Step 2 — coverage check / fallback.** If ANY covered chunk is missing from the tile DB
  (or `meta.mode_profile_hash` ≠ the running profile hash), **log it and fall back to
  `astar_multigoal_multimode` over the full bbox** (whole-route fallback — §9). No partial
  HPA*.
- **Step 3 — high-level search.** Build an abstract graph: nodes are `(chunk, entrance, mode)`
  triples; edges are either (a) precomputed chunk-internal costs from SQLite, or
  (b) chunk-boundary transitions — free for a shared border cell, or the flat mode-switch
  penalty at a transition entrance (§5). Seed from the start cell's chunk/entrance(s) and the
  start eligible modes; accept at the end cell's chunk/entrance(s) and end eligible modes.
  Run A* over this abstract graph (admissible heuristic: straight-line distance / fastest
  effective goal-mode speed, mirroring `astar_multigoal_multimode`'s §10 heuristic).
- **Step 4 — path stitching.** For each chunk on the abstract path, run a small A* in that
  chunk's **live** cost layer (rebuilt from the real rasters at native 30 m) between the
  entry and exit entrance to recover the actual `(row, col, mode)` cell sequence. Chunks are
  2,500 cells, so each refinement is sub-millisecond. Concatenate into the full path, then
  hand to the existing `_render_unified_path`.

The start and end cells are made entrances of their own chunks (like transition cells, §5) so
the abstract graph connects the true endpoints, not just border entrances.

---

## 9. Fallback strategy — **whole-route** (committed)

This spec commits to **whole-route fallback**: if tile coverage is incomplete for the route's
bbox (any missing chunk, or a stale `mode_profile_hash`), the entire query falls back to
today's `astar_multigoal_multimode` over the full bbox. HPA* is all-or-nothing per query.

Rationale: whole-route fallback is simpler to reason about and safer for partial rollouts —
the result is *always* either "full HPA*" or "exactly today's behaviour", with no hybrid
stitching at coverage seams. Per-chunk fallback (cover Idaho, fall back only in the gaps)
would let coverage grow incrementally, but stitching a precomputed abstract path to a
live cell-level search at the fallback boundary is fiddly and error-prone; deferred unless H5
shows whole-route fallback leaves too much uncovered.

---

## 10. What stays untouched

- `astar_multigoal_multimode` — the multimode kernel stays as the fallback path, unchanged.
- `astar_multigoal` — the single-mode kernel; reused by the **builder** unchanged.
- `compute_unified_cost_layers`, `transitions.py`, and the `_route_auto` flow stay in place.
  HPA* adds a faster path that engages **only when tiles are available**; everything else is
  exactly as shipped in #37–#42.

---

## 11. Migration plan (file-by-file, Phases H2–H5)

Each phase ≤ its own diff budget, HALT-at-diff at every boundary.

### H2 — build pipeline
- `+ backend/services/navi_offroute/hpa_build.py` (standalone CLI; reuses readers +
  `astar_multigoal`; writes the SQLite).
- `+ backend/services/navi_offroute/tests/test_hpa_build.py`.
- No `router.py`/`astar.py` wiring.

### H3 — runtime kernel + router wiring
- `astar.py`: `+ astar_hpa_multimode` (abstract search + per-chunk refinement). Existing
  kernels unchanged.
- `router.py`: `_route_auto` chooses HPA* vs unified-graph based on tile coverage (open the
  region SQLite, coverage-check, dispatch; whole-route fallback on miss).
- `+ backend/services/navi_offroute/tests/test_hpa_runtime.py`.

### H4 — ops
- Run `hpa_build.py` for Idaho, deploy `/mnt/nav/hpa/idaho.db` to VM 1130, smoke the three
  reference routes. No code.

### H5 — path-quality validation
- `+ backend/services/navi_offroute/tests/test_hpa_path_quality.py` — 20 representative
  routes through both the HPA* and unified-graph paths; assert the cost ratio is within a
  bound (§13).

---

## 12. Test plan per phase

- **H2 (build correctness):** a small hand-built fixture chunk with a known cost grid; assert
  the precomputed entrance-pair costs match a manual / brute-force computation, INF pruning is
  correct, and transition-cell entrances are stored. Deterministic chunk coords verified.
- **H3 (runtime correctness):** (a) high-level + low-level stitch produces a contiguous
  `(row, col, mode)` path matching `_route_auto`'s response shape; (b) fallback fires (and is
  logged) when a covered chunk is missing or the profile hash is stale; (c) mode-switch at a
  transition entrance is honoured.
- **H5 (path quality):** 20 representative routes (in-town, off-path, wilderness→home, dirt
  road, etc.) run through both paths; assert `hpa_cost / unified_cost ≤ 1 + ε` (target ε ≤ 5%,
  §13) and identical `selected_mode_set` on the §1 case.

---

## 13. Risk register

| Risk | Detail | Mitigation |
|---|---|---|
| **Bounded suboptimality from entrance sparsity** | 5 entrances/edge may miss an entry point real cell-level A* would use, inflating cost. | H5 measures `hpa_cost/unified_cost`; if the 95th-percentile ratio > 5%, raise entrances/edge (and rebuild). Cost is monotone in entrance count. |
| **Coverage gaps at region boundaries** | Tiles cover one region (Idaho + buffer); routes leaving it have missing chunks. | Whole-route fallback (§9) to `astar_multigoal_multimode`. Supported region boundary stored in `meta`; coverage-check before engaging HPA*. |
| **Stale tiles after DEM / mode-profile change** | Precomputed costs no longer match the live cost model. | `meta.mode_profile_hash` (hash of `MODE_PROFILES`) + DEM version; mismatch → fall back + log a rebuild-required warning. |
| **Transition cells moving between chunks on a DEM regrid** | Parking/trailhead chunk membership could shift, breaking stored transition entrances. | Chunk-coord origin pinned at lat=0/lon=0 modulo 1.5 km (§3): chunk identity is deterministic and regrid-stable. |
| **Mode-switch edges across chunk borders** | A parking lot on a chunk boundary belongs to two chunks; a switch there must be reachable from both. | The transition cell is added as an entrance to **both** neighbouring chunks (overlap, §5). |
| **SQLite read latency at query time** | Per-chunk cost lookups over virtiofs (host NVMe) — sub-ms cold, single-µs cached. SQLite-over-virtiofs is local-disk fast, not network-bound. | Costs are scalar and few (≤400 rows/chunk/mode); index `idx_chunk_mode`; batch-load the covered chunks once per query; the DB is small and OS-page-cacheable. |

---

## 14. Idaho initial target

- **Region:** Idaho state boundary + **50 km buffer** (per Matt's call), so cross-border
  egress near the state line stays covered.
- **Scale:** ~96K chunks; ~1.5 GB SQLite (sparse, likely less).
- **Build:** ~15 min on 16 cores.
- **Dependencies:** reuses the existing DEM / friction / trail / wilderness / MVUM readers —
  **no new IO dependencies**. Native 30 m resolution throughout (no downsampling, §1).
