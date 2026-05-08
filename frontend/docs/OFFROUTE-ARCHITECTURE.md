# OFFROUTE — Off-Network Effort-Based Routing Architecture

**Status:** Draft  
**Author:** Matt / Claude  
**Date:** 2026-05-07  
**Canonical location:** `matt/refactored-recon` alongside PROJECT-BIBLE.md, NAV-INTEGRATION-v4.md  

---

## 1. Vision

From any arbitrary point in the backcountry — no trails, no roads, no signal — route via effort cost and safety to the nearest trail, to a BLM/forest road, to a paved road, to home. Four segments, one continuous path, one GeoJSON response.

The system serves two interfaces:
- **Navi frontend** (`navi.echo6.co`) — visual route overlay on the map
- **Aurora via Meshtastic** — text-based step-by-step directions for a lost person with no map display

This capability does not exist in any open-source consumer product. CalTopo, OnX, Gaia GPS, AllTrails — all route on-network only. The military has Primordial Ground Guidance (closed-source ATAK plugin). We are building the open, self-hosted equivalent.

---

## 2. The Routing Chain

```
[Lost person]
     │
     ▼
 ┌──────────────────────────────────────────┐
 │  Segment 1: WILDERNESS → TRAIL           │
 │  Engine: Raster cost-surface pathfinder   │
 │  Cost: slope effort + vegetation +        │
 │        water barriers + land ownership    │
 │  Output: lat/lon waypoint sequence        │
 └──────────────────────────────────────────┘
     │ snap to nearest trail entry point
     ▼
 ┌──────────────────────────────────────────┐
 │  Segment 2: TRAIL → BLM/FOREST ROAD     │
 │  Engine: Valhalla (pedestrian/MTB)       │
 │  Cost: elevation-aware hike/bike profile │
 └──────────────────────────────────────────┘
     │ transition to road network
     ▼
 ┌──────────────────────────────────────────┐
 │  Segment 3: BLM ROAD → PAVED ROAD       │
 │  Engine: Valhalla (auto/motorcycle)      │
 │  Cost: standard + surface preference     │
 └──────────────────────────────────────────┘
     │
     ▼
 ┌──────────────────────────────────────────┐
 │  Segment 4: PAVED ROAD → HOME            │
 │  Engine: Valhalla (auto)                  │
 │  Cost: standard routing                   │
 └──────────────────────────────────────────┘
```

Segments 2–4 already work today via Valhalla. **Segment 1 is the engineering gap.**

---

## 3. Endpoint Design

### `POST /api/offroute`

**Request:**
```json
{
  "start": { "lat": 43.512, "lon": -114.823 },
  "destination": { "lat": 42.736, "lon": -114.514 },
  "mode": "foot",
  "max_search_km": 15
}
```

**Modes:** `foot` | `mtb` | `atv`

**Response:**
```json
{
  "segments": [
    {
      "type": "wilderness",
      "geometry": { "type": "LineString", "coordinates": [...] },
      "distance_m": 4200,
      "elevation_gain_m": 310,
      "elevation_loss_m": 85,
      "estimated_time_min": 72,
      "surface": "cross-country",
      "instructions": [
        { "bearing": 245, "distance_m": 320, "terrain": "sagebrush slope", "grade_pct": 8 },
        { "bearing": 260, "distance_m": 510, "terrain": "drainage crossing", "grade_pct": -12 }
      ]
    },
    {
      "type": "trail",
      "geometry": { "type": "LineString", "coordinates": [...] },
      "trail_name": "Pioneer Cabin Trail",
      "distance_m": 6100,
      "estimated_time_min": 85
    },
    {
      "type": "road_unpaved",
      "geometry": { "type": "LineString", "coordinates": [...] },
      "road_name": "FR-227",
      "distance_m": 12400,
      "estimated_time_min": 22
    },
    {
      "type": "road_paved",
      "geometry": { "type": "LineString", "coordinates": [...] },
      "distance_m": 34000,
      "estimated_time_min": 28
    }
  ],
  "total_distance_m": 56700,
  "total_time_min": 207,
  "confidence": 0.82
}
```

**Aurora tool integration:** Add `offroute` to `nav_tools.py` alongside existing `route()` and `reverse_geocode()`. The semantic query router gets a new embedding for "I'm lost, help me get home" / "navigate to nearest road" type queries.

---

## 4. Pathfinder Architecture (Segment 1)

### 4.1 No Pre-Rendered Slope Rasters

The pathfinder does NOT need pre-computed slope layers, GDAL processing, or reprojection. It reads elevation directly:

1. Routing request arrives with a start point and search radius
2. Determine which PMTiles z12 tiles cover the search area
3. Fetch + decode Terrarium tiles from `planet-dem.pmtiles` → numpy elevation arrays
4. Cache decoded arrays keyed by (z, x, y) — LRU, in-memory
5. A* / Dijkstra runs on the elevation grid, computing grade between neighbors on the fly
6. Cost function = `grade → effort model → multiply by land-cover friction → check barriers`

### 4.2 Elevation Data Source

**Primary:** `planet-dem.pmtiles` (658GB on pi-nas, served via nginx at `/tiles/planet-dem.pmtiles`)
- Mapterhorn, Copernicus GLO-30 source, Terrarium encoding (lossless WebP)
- z12 with 512px tiles = ~13–16m pixels at Idaho latitude
- 30m effective resolution (upsampled from source)
- Decode: `elevation = (R * 256 + G + B/256) - 32768` (metres, EGM2008)
- Precision: ~3.9mm quantization — far below source noise (~4m RMSE)

**Upgrade path:** USGS 3DEP 1/3 arc-second (10m bare-earth DTM, CONUS). Same architecture, denser grid. Free download. Address when/if 30m proves insufficient for safety.

**Regional GeoTIFFs** (203GB on NAS at `/mnt/nas/nav/contour-rebuild/dem/`): Keep as insurance until this pipeline is validated, then delete.

### 4.3 Cost Function

For each candidate move from cell A to cell B:

```python
def travel_cost(elev_a, elev_b, distance_m, friction_ab):
    grade = (elev_b - elev_a) / distance_m
    
    # Safety gate — impassable above threshold
    slope_deg = math.degrees(math.atan(abs(grade)))
    if slope_deg > MAX_SLOPE[mode]:  # foot=40°, mtb=25°, atv=30°
        return INF
    
    # Effort model (speed in km/h)
    if mode == "foot":
        # Tobler off-path hiking function
        speed = 0.6 * 6.0 * math.exp(-3.5 * abs(grade + 0.05))
    elif mode == "mtb":
        # Herzog wheeled-transport polynomial (crit_slope=8%)
        speed = herzog_wheeled(grade, crit_slope=0.08, base_speed=12)
    elif mode == "atv":
        # Herzog with higher base speed and slope tolerance
        speed = herzog_wheeled(grade, crit_slope=0.15, base_speed=25)
    
    # Time cost (seconds to traverse this cell)
    time_s = (distance_m / 1000.0) / speed * 3600.0
    
    # Multiply by land-cover friction
    time_s *= friction_ab
    
    return time_s
```

**Tobler off-path:** `W = 0.6 × 6 × exp(-3.5 × |S + 0.05|)` km/h  
Peak speed 3.6 km/h at ~-2.86° (slight downhill). The 0.6 multiplier is the off-trail penalty.

**Herzog wheeled-transport:** sixth-degree polynomial fitted to wheeled vehicle energy expenditure. Has a `crit_slope` parameter where switchbacks become more efficient than direct climb. Best published proxy for MTB/ATV in open-source literature.

**Reference implementations:** R `leastcostpath` package contains 30+ validated cost functions including Tobler, Tobler off-path, Irmischer-Clarke (male/female/off-path, fitted to USMA cadets), Naismith-Langmuir, Herzog, Minetti, Campbell 2019 percentiles. Port as needed.

### 4.4 Friction Layers (Cost Surface Inputs)

All pre-computed offline, tiled, cached. Updated infrequently.

| Layer | Source | Resolution | Purpose | Update Frequency |
|---|---|---|---|---|
| Elevation | planet-dem.pmtiles | ~30m (z12) | Slope/grade calculation | Static |
| Land cover | NLCD | 30m | Vegetation traversal friction | ~Annual |
| Waterways | OSM | Rasterized from vectors | Barrier (∞ cost) except at bridges/fords | Weekly from planet PBF |
| Water bodies | OSM `natural=water` | Rasterized polygons | Barrier (∞) | Weekly |
| Cliffs | OSM `natural=cliff` | Rasterized lines | Barrier (∞) | Weekly |
| Land ownership | PAD-US | Polygon raster | Access restrictions per mode | ~Quarterly |
| Trails/roads | OSM + USFS | Rasterized lines | Low-cost corridors (negative friction) | Weekly |

**NLCD friction mapping (foot mode example):**

| NLCD Class | Description | Friction Multiplier |
|---|---|---|
| 11 | Open Water | ∞ |
| 21 | Developed, Open Space | 1.0 |
| 22 | Developed, Low Intensity | 1.2 |
| 31 | Barren Land | 1.1 |
| 41 | Deciduous Forest | 1.8 |
| 42 | Evergreen Forest | 2.0 |
| 43 | Mixed Forest | 1.9 |
| 52 | Shrub/Scrub | 1.5 |
| 71 | Grassland/Herbaceous | 1.2 |
| 90 | Woody Wetlands | 3.5 |
| 95 | Emergent Herbaceous Wetlands | 4.0 |

Mode-specific adjustments: MTB and ATV get higher penalties on forest/wetland. ATV gets ∞ on wilderness-designated areas (PAD-US `Des_Tp = WA`).

**Trail burn-in:** Rasterize OSM trails/tracks as cells with reduced friction (trail cell = 0.5× base, track = 0.3×, road = 0.1×). The pathfinder naturally gravitates toward and follows these corridors without special logic.

### 4.5 Engine Choice

**Recommended: scikit-image `MCP_Geometric` for initial build.**

- Cython Dijkstra, 1–5 seconds on 2–4M cell grids
- `find_costs(start)` computes cumulative cost surface once; `traceback(target)` for any target is O(path length) — reuse for "nearest trail," "nearest road," and destination all in one pass
- `MCP_Flexible` subclass allows overriding `_travel_cost()` for anisotropic costs (uphill ≠ downhill)
- Pure Python integration with Flask backend
- Memory OK up to ~20–40M cells on 24GB

**Performance path: Rust `pathfinding` crate as a microservice.**

- A*, Dijkstra, HPA* (hierarchical) all available
- Custom successor function encodes anisotropic cost
- Sub-second on 4M cells
- `hierarchical_pathfinding` crate enables multi-resolution: coarse pass → refine in corridor
- Wrap in Axum HTTP server, call from Flask

**Decision:** Start with scikit-image Python. If latency is a problem, rewrite the inner loop in Rust. The cost function, data pipeline, and API don't change.

### 4.6 Multi-Resolution Strategy

For routes where the wilderness segment exceeds ~10km, full-resolution pathfinding on the entire search area gets expensive. Use the Primordial Ground Guidance approach:

1. **Coarse pass:** Downsample cost grid 4× (120m cells). Solve A*. Sub-second.
2. **Corridor extraction:** Buffer the coarse path by 200m.
3. **Fine pass:** Re-solve at native 30m resolution only within the corridor. Sub-second.
4. **Total:** <2 seconds for a 15km wilderness segment.

### 4.7 Network Hand-Off

The raster pathfinder needs to know where the trail/road network starts so it can stop:

1. **Pre-compute trail entry points:** Extract from OSM all endpoints and intersections of `highway=path|track|footway|bridleway|unclassified|tertiary|secondary|primary`. Store as a PostGIS point table (or SQLite spatial index in `navi.db`).
2. **Rasterize entry points** onto the cost grid as target cells.
3. **Run `MCP.find_costs(start)`** — the Dijkstra wave expands until it reaches any entry-point cell. Use `goal_reached()` override in `MCP_Flexible` for early termination.
4. **Snap** the reached entry point to its nearest Valhalla graph node.
5. **Call Valhalla** from that node to destination with appropriate costing profile.
6. **Concatenate** raster path + Valhalla path into one GeoJSON with per-segment metadata.

---

## 5. Data Acquisition Checklist

| Dataset | Status | Size | Action |
|---|---|---|---|
| DEM (planet-dem.pmtiles) | ✅ Have it | 658GB | Serving via nginx from pi-nas |
| NLCD Land Cover (CONUS) | ❌ Not acquired | ~5GB | Download from USGS MRLC |
| NLCD Tree Canopy (CONUS) | ❌ Not acquired | ~2GB | Optional — continuous friction surface |
| OSM Planet PBF | ❌ Not acquired for this use | ~70GB | Extract waterways, cliffs, trails via osmium |
| PAD-US | ✅ Have source | 1.6GB in /mnt/nav/padus/ | Rasterize by access class |
| USFS Trail/Road layers | ✅ Have PMTiles | 848MB + 496MB | Need raw vectors for rasterization |
| Trail entry points index | ❌ Not built | ~50MB | Extract from OSM + USFS |

**First acquisition:** NLCD. It's the single most impactful layer after the DEM — without land cover, the pathfinder can't distinguish open meadow from dense forest.

---

## 6. Safety Considerations

This system may guide people through dangerous terrain. Design constraints:

- **Hard slope cutoffs are non-negotiable.** No route segment should ever cross terrain above the mode's max slope threshold, regardless of how much faster the direct path would be.
- **Confidence scoring:** Every response includes a `confidence` field (0.0–1.0) based on: DEM resolution vs route steepness, distance from nearest verified trail data, land cover data freshness, number of barrier crossings.
- **Fallback behaviors:** If no safe route exists within `max_search_km`, return an error with the direction and distance to the nearest trail (as a bearing, not a route). Never hallucinate a route through impassable terrain.
- **Per-step user confirmation (Aurora/Meshtastic):** In text mode, Aurora should confirm each major terrain transition ("You will cross a drainage heading southwest — confirm you can see safe footing"). A lost person should never blindly follow instructions into terrain they can't visually verify.
- **DSM vs DTM caveat:** Copernicus GLO-30 is a Digital Surface Model (includes treetops, buildings). A flat meadow next to tall pines will show false slope at the treeline. The system should note this in Aurora's instructions for forested areas.
- **30m resolution risk:** A 15m-wide cliff band can be smoothed into a single "steep but passable" cell. The safety gate catches obvious cliffs but may miss narrow features. Documented limitation; mitigated by upgrading to 10m USGS 3DEP in the future.

---

## 7. Implementation Phases

### Phase O1: Foundation
- Acquire NLCD CONUS land cover
- Build PMTiles elevation decoder + tile cache module
- Implement Tobler off-path cost function
- Prototype: scikit-image MCP on a small Idaho bbox (e.g., 20km × 20km around Sun Valley)
- Validate: does the path avoid canyons, prefer gentle slopes, follow drainages?

### Phase O2: Friction Integration
- Rasterize NLCD into friction grid
- Rasterize OSM waterways/cliffs as barriers
- Rasterize PAD-US access restrictions
- Burn OSM trails/roads as low-cost corridors
- Combined cost surface for foot mode

### Phase O3: Network Hand-Off
- Build trail entry point index from OSM + USFS
- Implement MCP → Valhalla stitching
- `/api/offroute` endpoint (foot mode only)
- GeoJSON response with per-segment metadata

### Phase O4: Multi-Mode + Aurora
- Add MTB cost function (Herzog wheeled-transport)
- Add ATV cost function
- Mode-specific barrier rules (wilderness restrictions for MTB/ATV)
- Aurora tool integration — `offroute` in nav_tools.py
- Meshtastic text-based instruction generation (bearings, terrain descriptions)

### Phase O5: Performance + Polish
- Multi-resolution pathfinding (coarse → corridor → fine)
- Rust pathfinder microservice (if Python latency is insufficient)
- Confidence scoring
- Navi frontend route visualization with segment coloring
- Elevation profile display per segment

### Phase O6: Pi 5 Field Kit
- Offline PMTiles elevation access
- Pre-baked cost tiles for Idaho/CONUS-West
- Bbox-filter packager for all spatial datasets
- Full offline operation via Meshtastic ↔ Aurora ↔ offroute chain

---

## 8. Infrastructure

**Runtime services (VM 1130):**
- `/api/offroute` — Flask endpoint in RECON dashboard
- Tile cache — LRU in-memory decoded elevation arrays
- Valhalla Docker :8002 — on-network routing (already running)

**Data (VM 1130 /mnt/nav/):**
- Pre-baked friction rasters (NLCD, barriers, trails) — tiled GeoTIFF or COG
- Trail entry point index — SQLite spatial in navi.db

**Data (pi-nas /mnt/nas/nav/):**
- planet-dem.pmtiles — 658GB, served via nginx
- Regional GeoTIFF DEMs — 203GB, insurance until pipeline validated

**Compute (cortex or matt-desktop):**
- One-time cost surface generation jobs (NLCD rasterization, OSM extraction, barrier tiling)

---

## 9. Key Decisions Made

| Decision | Rationale |
|---|---|
| No pre-rendered slope rasters | Pathfinder computes grade on the fly from cached elevation arrays. Simpler, no GDAL dependency at runtime. |
| planet-dem.pmtiles as single elevation source | Same data already drives contours + hillshade. 30m sufficient for first build. Global coverage. |
| scikit-image MCP for initial engine | Cython Dijkstra, proven on 2–4M cell grids, Python-native, anisotropic via MCP_Flexible. Rust upgrade path if needed. |
| Tobler off-path as primary foot cost model | Best-validated off-trail hiking function. Inherently anisotropic. 0.6× off-trail multiplier built in. |
| Trail burn-in (not separate hand-off logic) | Rasterizing trails as low-cost cells lets the pathfinder naturally follow them without mode-switching logic. |
| Pre-baked friction rasters (offline) | NLCD, barriers, and land ownership change slowly. Build once, cache, update periodically. |
| Multi-resolution for long routes | Coarse pass → corridor → fine pass. Standard technique from military route planning (Primordial Ground Guidance). |
| Confidence scoring on every response | Safety-critical system. User must know when to trust vs. verify the route. |

---

## 10. Open Questions

- [ ] What is the right `max_slope` cutoff per mode? Needs field testing / literature review.
- [ ] Should the pathfinder use A* (faster, needs admissible heuristic) or Dijkstra (guaranteed optimal, slower)? MCP uses Dijkstra; pyastar2d uses A*.
- [ ] How to generate natural-language terrain descriptions for Aurora from raster data? (e.g., "sagebrush slope" vs. "forested drainage")
- [ ] Should we pre-compute the full cost surface for Idaho/CONUS-West, or generate it on demand per request?
- [ ] How to handle seasonal/weather variations? (Snow, spring runoff, wildfire closures)
- [ ] Valhalla pedestrian elevation costing (PR #3234) — test and validate before relying on it for segments 2–4.
- [ ] USFS MVUM (Motor Vehicle Use Maps) — authoritative ATV/4WD legal access layer. Acquire and integrate for ATV mode.

---

## References

- Tobler, W. (1993). Three Presentations on Geographical Analysis and Modeling. NCGIA TR 93-1.
- Irmischer, I.J. & Clarke, K.C. (2018). Measuring and modeling the speed of human navigation. *Cartography and GIS*, 45(2), 177-186.
- Herzog, I. (2020). Spatial Analysis Based on Cost Functions. In *Archaeological Spatial Analysis*.
- Lewis, J. (2023). `leastcostpath` R package. CRAN.
- GRASS GIS. `r.walk` manual. grass.osgeo.org.
- Hoover, B. et al. (2019). CostMAP: An open-source software package for developing cost surfaces. LANL.
- Mapterhorn project. mapterhorn.com. BSD-3.


---

## 11. On-Network Traffic Intelligence

Two features that affect Valhalla segments (2–4) of the offroute chain, not the wilderness pathfinder (segment 1):

### Traffic-Aware Routing

- Valhalla supports time-dependent costing via traffic speed tiles
- TomTom traffic tiles already integrated in Navi at `/api/traffic/*` (currently visual overlay only)
- **Integration path:** configure Valhalla `traffic_tile_dir` to consume TomTom speed data so route calculations account for live congestion
- **Effect on offroute:** segments 2–4 (trail-to-road, road-to-road, road-to-home) would route around congested corridors
- Does NOT affect segment 1 (wilderness pathfinder)

### Idaho 511 Incident Feed

- Idaho 511 API provides real-time construction zones, accidents, and road closures
- Two integration points:
  1. **Visual layer** — display incidents on Navi map as icons/overlays
  2. **Routing barriers** — feed active closures to Valhalla as `avoid_locations` or edge exclusions so routes avoid closed roads
- **Implementation:** polling daemon (5–10 min interval), stores active incidents in `navi.db`, expires automatically when cleared
- Affects both standalone Valhalla routing and offroute segments 2–4
- **Stretch goal:** ingest other state 511 feeds for cross-state trips

### Sequencing

- Both features are post-offroute-core (after Phase O3)
- Can be built in parallel — traffic routing is Valhalla config, 511 is a new ingestion daemon + map layer
- Neither blocks wilderness pathfinder development
