import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedTheme } from 'protomaps-themes-base'
import { getTheme, getThemeSprite, getOverlayConfig } from '../themes/registry'
import { useStore } from '../store'
import { decodePolyline } from '../utils/decode'
import { fetchReverse } from '../api'
import { getConfig, hasFeature } from '../config'
import { MapPin, Navigation, ArrowUpRight, ArrowDownLeft, Plus, Star, Ruler, X } from 'lucide-react'
import RadialMenu from './RadialMenu'
import useContextMenu from '../hooks/useContextMenu'
import toast from 'react-hot-toast'


/** Check if current theme is dark based on registry */
function isCurrentThemeDark() {
  const themeId = document.documentElement.getAttribute('data-theme') || 'dark'
  return getTheme(themeId).dark
}

const ROUTE_SOURCE = 'route-source'
const BOUNDARY_SOURCE = 'boundary-source'
const BOUNDARY_LAYER = 'boundary-layer'
const ROUTE_LAYER_PREFIX = 'route-layer-'
const HILLSHADE_SOURCE = 'hillshade-dem'
const HILLSHADE_LAYER = 'hillshade-layer'
const TRAFFIC_SOURCE = 'traffic-tiles'
const TRAFFIC_LAYER = 'traffic-layer'
const PUBLIC_LANDS_SOURCE = 'public-lands-tiles'
const PUBLIC_LANDS_FILL = 'public-lands-fill'
const PUBLIC_LANDS_LINE = 'public-lands-line'
const PUBLIC_LANDS_LABEL = 'public-lands-label'
const CONTOUR_SOURCE = 'contour-tiles'
const CONTOUR_MINOR = 'contour-minor'
const CONTOUR_INTERMEDIATE = 'contour-intermediate'
const CONTOUR_INDEX = 'contour-index'
const CONTOUR_LABEL = 'contour-label'
const CONTOUR_TEST_SOURCE = 'contour-test-tiles'
const CONTOUR_TEST_MINOR = 'contour-test-minor'
const CONTOUR_TEST_INTERMEDIATE = 'contour-test-intermediate'
const CONTOUR_TEST_INDEX = 'contour-test-index'
const CONTOUR_TEST_LABEL = 'contour-test-label'
const CONTOUR_TEST_10FT_SOURCE = 'contour-test-10ft-tiles'
const CONTOUR_TEST_10FT_MINOR = 'contour-test-10ft-minor'
const CONTOUR_TEST_10FT_INTERMEDIATE = 'contour-test-10ft-intermediate'
const CONTOUR_TEST_10FT_INDEX = 'contour-test-10ft-index'
const CONTOUR_TEST_10FT_LABEL = 'contour-test-10ft-label'
const MEASURE_SOURCE = 'measure-source'
const MEASURE_LINE_LAYER = 'measure-line-layer'
const MEASURE_POINT_LAYER = 'measure-point-layer'
const USFS_SOURCE = 'usfs-trails-source'
const USFS_ROADS_LAYER = 'usfs-roads-layer'
const USFS_TRAILS_LAYER = 'usfs-trails-layer'
const USFS_ROADS_LABEL = 'usfs-roads-label'
const USFS_TRAILS_LABEL = 'usfs-trails-label'
const USFS_ROADS_HIT = 'usfs-roads-hit'
const USFS_TRAILS_HIT = 'usfs-trails-hit'
const BLM_SOURCE = 'blm-trails-source'
const BLM_ROUTES_NATURAL = 'blm-routes-natural'
const BLM_ROUTES_IMPROVED = 'blm-routes-improved'
const BLM_ROUTES_AGGREGATE = 'blm-routes-aggregate'
const BLM_ROUTES_SNOW = 'blm-routes-snow'
const BLM_ROUTES_OTHER = 'blm-routes-other'
const BLM_ROUTES_LABEL = 'blm-routes-label'
const BLM_ROUTES_HIT = 'blm-routes-hit'
const SATELLITE_SOURCE = 'satellite-source'
const SATELLITE_LAYER = 'satellite-layer'


// Highlight state - use data-driven expressions to target specific features
const INTERACTIVE_LABEL_LAYERS = ['pois', 'places_subplace', 'places_locality', 'places_region', 'places_country']
let originalPaintValues = {} // Store original paint values for restoration
let highlightState = {
  hoveredLayer: null,
  hoveredName: null,
  selectedLayer: null,
  selectedName: null,
}

function storeOriginalPaint(map, layerId) {
  if (originalPaintValues[layerId]) return
  if (!map.getLayer(layerId)) return
  originalPaintValues[layerId] = {
    'text-color': map.getPaintProperty(layerId, 'text-color'),
    'text-halo-color': map.getPaintProperty(layerId, 'text-halo-color'),
    'text-halo-width': map.getPaintProperty(layerId, 'text-halo-width'),
  }
}

function restoreOriginalPaint(map, layerId) {
  if (!originalPaintValues[layerId] || !map.getLayer(layerId)) return
  const orig = originalPaintValues[layerId]
  if (orig['text-color'] !== undefined) map.setPaintProperty(layerId, 'text-color', orig['text-color'])
  if (orig['text-halo-color'] !== undefined) map.setPaintProperty(layerId, 'text-halo-color', orig['text-halo-color'])
  if (orig['text-halo-width'] !== undefined) map.setPaintProperty(layerId, 'text-halo-width', orig['text-halo-width'])
}

function applyHighlightExpression(map, layerId) {
  if (!map.getLayer(layerId)) return
  storeOriginalPaint(map, layerId)

  const orig = originalPaintValues[layerId]
  const isDark = isCurrentThemeDark()
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7a9a6b'

  // Hover: darken text slightly, bump halo to full opacity for focus effect
  const hoverColor = isDark ? '#ffffff' : '#000000'
  const hoverHaloColor = isDark ? 'rgba(30,30,30,1)' : 'rgba(255,255,255,1)'
  // Selected: accent color text with solid white halo at full opacity
  const selectedHaloColor = isDark ? 'rgba(30,30,30,1)' : 'rgba(255,255,255,1)'

  const isHovered = highlightState.hoveredLayer === layerId && highlightState.hoveredName
  const isSelected = highlightState.selectedLayer === layerId && highlightState.selectedName

  // Build case expressions for each paint property
  // Priority: selected > hover > original

  if (isSelected && isHovered && highlightState.selectedName !== highlightState.hoveredName) {
    // Both selected and hover active on different features
    map.setPaintProperty(layerId, 'text-color', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], accentColor,
      ['==', ['get', 'name'], highlightState.hoveredName], hoverColor,
      orig['text-color'] || (isDark ? '#e0e0e0' : '#2a2a2a')
    ])
    map.setPaintProperty(layerId, 'text-halo-color', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], selectedHaloColor,
      ['==', ['get', 'name'], highlightState.hoveredName], hoverHaloColor,
      orig['text-halo-color'] || (isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)')
    ])
    map.setPaintProperty(layerId, 'text-halo-width', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], 2.2,
      ['==', ['get', 'name'], highlightState.hoveredName], 2,
      orig['text-halo-width'] || 1.5
    ])
  } else if (isSelected) {
    // Only selected
    map.setPaintProperty(layerId, 'text-color', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], accentColor,
      orig['text-color'] || (isDark ? '#e0e0e0' : '#2a2a2a')
    ])
    map.setPaintProperty(layerId, 'text-halo-color', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], selectedHaloColor,
      orig['text-halo-color'] || (isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)')
    ])
    map.setPaintProperty(layerId, 'text-halo-width', [
      'case',
      ['==', ['get', 'name'], highlightState.selectedName], 2.2,
      orig['text-halo-width'] || 1.8
    ])
  } else if (isHovered) {
    // Only hovered
    map.setPaintProperty(layerId, 'text-color', [
      'case',
      ['==', ['get', 'name'], highlightState.hoveredName], hoverColor,
      orig['text-color'] || (isDark ? '#e0e0e0' : '#2a2a2a')
    ])
    map.setPaintProperty(layerId, 'text-halo-color', [
      'case',
      ['==', ['get', 'name'], highlightState.hoveredName], hoverHaloColor,
      orig['text-halo-color'] || (isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)')
    ])
    map.setPaintProperty(layerId, 'text-halo-width', [
      'case',
      ['==', ['get', 'name'], highlightState.hoveredName], 2,
      orig['text-halo-width'] || 1.8
    ])
  } else {
    // No highlight on this layer - restore original
    restoreOriginalPaint(map, layerId)
  }
}

function setHoverHighlight(map, feature) {
  const prevLayer = highlightState.hoveredLayer

  if (!feature) {
    highlightState.hoveredLayer = null
    highlightState.hoveredName = null
    if (prevLayer) applyHighlightExpression(map, prevLayer)
    return
  }

  const layerId = feature.layer?.id
  const name = feature.properties?.name
  if (!layerId || !name || !map.getLayer(layerId)) return

  // Don't hover the selected feature
  if (layerId === highlightState.selectedLayer && name === highlightState.selectedName) return

  highlightState.hoveredLayer = layerId
  highlightState.hoveredName = name

  // Update previous layer if different
  if (prevLayer && prevLayer !== layerId) {
    applyHighlightExpression(map, prevLayer)
  }
  // Update current layer
  applyHighlightExpression(map, layerId)
}

function setSelectedHighlight(map, feature) {
  const prevLayer = highlightState.selectedLayer

  if (!feature) {
    highlightState.selectedLayer = null
    highlightState.selectedName = null
    highlightState.hoveredLayer = null
    highlightState.hoveredName = null
    if (prevLayer) applyHighlightExpression(map, prevLayer)
    return
  }

  const layerId = feature.layer?.id
  const name = feature.properties?.name
  if (!layerId || !name || !map.getLayer(layerId)) return

  highlightState.selectedLayer = layerId
  highlightState.selectedName = name
  // Clear hover when selecting
  highlightState.hoveredLayer = null
  highlightState.hoveredName = null

  // Update previous layer if different
  if (prevLayer && prevLayer !== layerId) {
    applyHighlightExpression(map, prevLayer)
  }
  // Update current layer
  applyHighlightExpression(map, layerId)
}

function clearAllHighlights(map) {
  const layers = [highlightState.hoveredLayer, highlightState.selectedLayer].filter(Boolean)
  highlightState.hoveredLayer = null
  highlightState.hoveredName = null
  highlightState.selectedLayer = null
  highlightState.selectedName = null
  layers.forEach(layerId => restoreOriginalPaint(map, layerId))
}

/** Apply improved base label styling for readability (Google Maps style) */
function applyBaseLabelStyling(map) {
  const isDark = isCurrentThemeDark()

  INTERACTIVE_LABEL_LAYERS.forEach(layerId => {
    if (!map.getLayer(layerId)) return

    // Base styling: dark text with solid opaque white halo for knockout effect
    // This ensures labels read cleanly over any background (parks, water, terrain)
    map.setPaintProperty(layerId, 'text-color', isDark ? '#e0e0e0' : '#2a2a2a')
    map.setPaintProperty(layerId, 'text-halo-color', isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)')
    map.setPaintProperty(layerId, 'text-halo-width', 1.8)

    // Store these as the original values for highlight restoration
    originalPaintValues[layerId] = {
      'text-color': isDark ? '#e0e0e0' : '#2a2a2a',
      'text-halo-color': isDark ? 'rgba(20,20,20,0.9)' : 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.8,
    }
  })
}

/** Build a full MapLibre style object for the given theme */
function buildStyle(themeName) {
  const config = getConfig()
  const tileUrl = config?.tileset?.url || '/tiles/planet/planet-20260420.pmtiles'
  const attribution = config?.tileset?.attribution || 'Protomaps \u00a9 OSM'

  // Use namedTheme directly for built-in themes, custom colors for others
  const theme = getTheme(themeName)
  const colors = theme.colors || namedTheme(themeName)

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: getThemeSprite(themeName),
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tileUrl}`,
        attribution,
      },
    },
    layers: layers('protomaps', colors, { lang: 'en' }),
  }
}

/** SVG for ATAK-style chevron pointing up (will be rotated via CSS) */
/** Calculate haversine distance between two points in meters */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/** Format distance for display (feet/miles, imperial) */
function formatDistance(meters) {
  const feet = meters * 3.28084
  if (feet < 1000) return Math.round(feet) + " ft"
  const miles = feet / 5280
  return miles < 10 ? miles.toFixed(2) + " mi" : miles.toFixed(1) + " mi"
}

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1 L14 13 L8 10 L2 13 Z" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`

/** Add hillshade raster-dem source + layer to the map */
function addHillshade(map, themeId) {
  if (!map || map.getSource(HILLSHADE_SOURCE)) return
  const config = getConfig()
  const hs = config?.tileset_hillshade
  if (!hs?.url) return

  const c = getOverlayConfig(themeId, 'hillshade')

  map.addSource(HILLSHADE_SOURCE, {
    type: 'raster-dem',
    url: `pmtiles://${hs.url}`,
    encoding: hs.encoding || 'terrarium',
    tileSize: 256,
    maxzoom: hs.max_zoom || 12,
  })

  // Insert below the first symbol/label layer for proper z-ordering
  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol') {
      beforeId = layer.id
      break
    }
  }

  map.addLayer({
    id: HILLSHADE_LAYER,
    type: 'hillshade',
    source: HILLSHADE_SOURCE,
    paint: {
      'hillshade-exaggeration': c.exaggeration,
      'hillshade-illumination-direction': c.illuminationDirection,
      'hillshade-shadow-color': c.shadowColor,
      'hillshade-highlight-color': c.highlightColor,
    },
  }, beforeId)
}

/** Remove hillshade layer + source */
function removeHillshade(map) {
  if (!map) return
  if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER)
  if (map.getSource(HILLSHADE_SOURCE)) map.removeSource(HILLSHADE_SOURCE)
}

/** Add traffic raster tile source + layer */
function addTraffic(map, themeId) {
  if (!map || map.getSource(TRAFFIC_SOURCE)) return
  const config = getConfig()
  const tr = config?.traffic
  if (!tr?.proxy_url) return

  const c = getOverlayConfig(themeId, 'traffic')
  const tileUrl = tr.proxy_url.replace('{z}', '{z}').replace('{x}', '{x}').replace('{y}', '{y}')

  map.addSource(TRAFFIC_SOURCE, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    maxzoom: 18,
  })

  map.addLayer({
    id: TRAFFIC_LAYER,
    type: 'raster',
    source: TRAFFIC_SOURCE,
    paint: {
      'raster-opacity': c.opacity,
    },
  })
}

/** Remove traffic layer + source */
function removeTraffic(map) {
  if (!map) return
  if (map.getLayer(TRAFFIC_LAYER)) map.removeLayer(TRAFFIC_LAYER)
  if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE)
}

/** Add public lands vector tile overlay (PAD-US) */
function addPublicLands(map, themeId) {
  if (!map || map.getSource(PUBLIC_LANDS_SOURCE)) return

  const c = getOverlayConfig(themeId, 'publicLands')

  map.addSource(PUBLIC_LANDS_SOURCE, {
    type: 'vector',
    url: 'pmtiles:///tiles/public-lands.pmtiles',
  })

  // Insert below symbol layers for proper z-ordering
  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol') {
      beforeId = layer.id
      break
    }
  }

  // Fill layer — data-driven color by agency + designation
  map.addLayer({
    id: PUBLIC_LANDS_FILL,
    type: 'fill',
    source: PUBLIC_LANDS_SOURCE,
    'source-layer': 'public_lands',
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'designation'], 'WA'], c.fillWA,
        ['==', ['get', 'designation'], 'WSA'], c.fillWA,
        ['==', ['get', 'agency'], 'NPS'], c.fillNPS,
        ['==', ['get', 'agency'], 'USFS'], c.fillUSFS,
        ['==', ['get', 'agency'], 'BLM'], c.fillBLM,
        ['==', ['get', 'agency'], 'FWS'], c.fillFWS,
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR'],
          ['==', ['get', 'agency'], 'SDC'],
          ['==', ['get', 'agency'], 'SLB']
        ], c.fillSTAT,
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], c.fillLOC,
        c.fillDefault
      ],
      'fill-opacity': [
        'case',
        ['==', ['get', 'designation'], 'WA'], c.fillOpacityWA * c.opacityMod,
        ['==', ['get', 'designation'], 'WSA'], c.fillOpacityWA * c.opacityMod,
        ['==', ['get', 'agency'], 'NPS'], c.fillOpacityNPS * c.opacityMod,
        ['==', ['get', 'agency'], 'USFS'], c.fillOpacityUSFS * c.opacityMod,
        ['==', ['get', 'agency'], 'BLM'], c.fillOpacityBLM * c.opacityMod,
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR']
        ], c.fillOpacitySTAT * c.opacityMod,
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], c.fillOpacityLOC * c.opacityMod,
        c.fillOpacityDefault * c.opacityMod
      ],
    },
  }, beforeId)

  // Outline layer
  map.addLayer({
    id: PUBLIC_LANDS_LINE,
    type: 'line',
    source: PUBLIC_LANDS_SOURCE,
    'source-layer': 'public_lands',
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'designation'], 'WA'], c.outlineWA,
        ['==', ['get', 'designation'], 'WSA'], c.outlineWA,
        ['==', ['get', 'agency'], 'NPS'], c.outlineNPS,
        ['==', ['get', 'agency'], 'USFS'], c.outlineUSFS,
        ['==', ['get', 'agency'], 'BLM'], c.outlineBLM,
        ['==', ['get', 'agency'], 'FWS'], c.outlineFWS,
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR']
        ], c.outlineSTAT,
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], c.outlineLOC,
        c.outlineDefault
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'agency'], 'NPS'], c.outlineOpacityNPS,
        ['==', ['get', 'agency'], 'USFS'], c.outlineOpacityUSFS,
        ['==', ['get', 'agency'], 'BLM'], c.outlineOpacityDefault,
        c.outlineOpacityDefault
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        4, c.outlineWidth.z4,
        8, c.outlineWidth.z8,
        12, c.outlineWidth.z12
      ],
    },
  }, beforeId)

  // Label layer — unit names at zoom 10+
  map.addLayer({
    id: PUBLIC_LANDS_LABEL,
    type: 'symbol',
    source: PUBLIC_LANDS_SOURCE,
    'source-layer': 'public_lands',
    minzoom: 10,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, c.labelSize.z10, 14, c.labelSize.z14],
      'text-font': c.labelFont,
      'symbol-placement': 'point',
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': c.labelColor,
      'text-halo-color': c.labelHaloColor,
      'text-halo-width': c.labelHaloWidth,
      'text-opacity': c.labelOpacity,
    },
  })
}

/** Remove public lands layers + source */
function removePublicLands(map) {
  if (!map) return
  if (map.getLayer(PUBLIC_LANDS_LABEL)) map.removeLayer(PUBLIC_LANDS_LABEL)
  if (map.getLayer(PUBLIC_LANDS_LINE)) map.removeLayer(PUBLIC_LANDS_LINE)
  if (map.getLayer(PUBLIC_LANDS_FILL)) map.removeLayer(PUBLIC_LANDS_FILL)
  if (map.getSource(PUBLIC_LANDS_SOURCE)) map.removeSource(PUBLIC_LANDS_SOURCE)
}

/** Add topographic contour vector tile overlay */
function addContours(map, themeId) {
  if (!map || map.getSource(CONTOUR_SOURCE)) return

  const c = getOverlayConfig(themeId, 'contours')

  map.addSource(CONTOUR_SOURCE, {
    type: 'vector',
    url: 'pmtiles:///tiles/contours-na.pmtiles',
  })

  // Insert below first symbol layer (above hillshade, below labels)
  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol') {
      beforeId = layer.id
      break
    }
  }

  // Minor contours (40ft) — visible z11+
  map.addLayer({
    id: CONTOUR_MINOR,
    type: 'line',
    source: CONTOUR_SOURCE,
    'source-layer': 'contours',
    minzoom: 11,
    filter: ['==', ['get', 'tier'], 'minor'],
    paint: {
      'line-color': c.minorColor,
      'line-opacity': c.minorOpacity * c.opacityMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, c.minorWidth.z11, 14, c.minorWidth.z14],
    },
  }, beforeId)

  // Intermediate contours (200ft) — visible z8+
  map.addLayer({
    id: CONTOUR_INTERMEDIATE,
    type: 'line',
    source: CONTOUR_SOURCE,
    'source-layer': 'contours',
    minzoom: 8,
    filter: ['==', ['get', 'tier'], 'intermediate'],
    paint: {
      'line-color': c.intermediateColor,
      'line-opacity': c.intermediateOpacity * c.opacityMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, c.intermediateWidth.z8, 14, c.intermediateWidth.z14],
    },
  }, beforeId)

  // Index contours (1000ft) — visible z4+
  map.addLayer({
    id: CONTOUR_INDEX,
    type: 'line',
    source: CONTOUR_SOURCE,
    'source-layer': 'contours',
    minzoom: 4,
    filter: ['==', ['get', 'tier'], 'index'],
    paint: {
      'line-color': c.indexColor,
      'line-opacity': c.indexOpacity * c.opacityMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, c.indexWidth.z4, 14, c.indexWidth.z14],
    },
  }, beforeId)

  // Elevation labels on index contours (z12+)
  map.addLayer({
    id: CONTOUR_LABEL,
    type: 'symbol',
    source: CONTOUR_SOURCE,
    'source-layer': 'contours',
    minzoom: 12,
    filter: ['==', ['get', 'tier'], 'index'],
    layout: {
      'text-field': ['concat', ['to-string', ['get', 'elevation_ft']], "'"],
      'text-size': c.labelSize,
      'text-font': c.labelFont,
      'symbol-placement': 'line',
      'text-anchor': 'center',
      'symbol-spacing': 400,
      'text-max-angle': 30,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': c.labelColor,
      'text-halo-color': c.labelHaloColor,
      'text-halo-width': c.labelHaloWidth,
      'text-opacity': c.labelOpacity,
    },
  })
}

/** Remove contour layers + source */
function removeContours(map) {
  if (!map) return
  if (map.getLayer(CONTOUR_LABEL)) map.removeLayer(CONTOUR_LABEL)
  if (map.getLayer(CONTOUR_INDEX)) map.removeLayer(CONTOUR_INDEX)
  if (map.getLayer(CONTOUR_INTERMEDIATE)) map.removeLayer(CONTOUR_INTERMEDIATE)
  if (map.getLayer(CONTOUR_MINOR)) map.removeLayer(CONTOUR_MINOR)
  if (map.getSource(CONTOUR_SOURCE)) map.removeSource(CONTOUR_SOURCE)
}

/** Add TEST topographic contour overlay (blue color scheme) */
function addContoursTest(map, themeId) {
  if (!map || map.getSource(CONTOUR_TEST_SOURCE)) return

  const c = getOverlayConfig(themeId, 'contoursTest')

  map.addSource(CONTOUR_TEST_SOURCE, {
    type: "vector",
    url: "pmtiles:///tiles/contours-test.pmtiles",
  })

  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol") {
      beforeId = layer.id
      break
    }
  }

  // Minor contours (40ft) — blue scheme
  map.addLayer({
    id: CONTOUR_TEST_MINOR,
    type: "line",
    source: CONTOUR_TEST_SOURCE,
    "source-layer": "contours",
    minzoom: 11,
    filter: ["==", ["get", "tier"], "minor"],
    paint: {
      "line-color": c.minorColor,
      "line-opacity": c.minorOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, c.minorWidth.z11, 14, c.minorWidth.z14],
    },
  }, beforeId)

  // Intermediate contours (200ft)
  map.addLayer({
    id: CONTOUR_TEST_INTERMEDIATE,
    type: "line",
    source: CONTOUR_TEST_SOURCE,
    "source-layer": "contours",
    minzoom: 8,
    filter: ["==", ["get", "tier"], "intermediate"],
    paint: {
      "line-color": c.intermediateColor,
      "line-opacity": c.intermediateOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, c.intermediateWidth.z8, 14, c.intermediateWidth.z14],
    },
  }, beforeId)

  // Index contours (1000ft)
  map.addLayer({
    id: CONTOUR_TEST_INDEX,
    type: "line",
    source: CONTOUR_TEST_SOURCE,
    "source-layer": "contours",
    minzoom: 4,
    filter: ["==", ["get", "tier"], "index"],
    paint: {
      "line-color": c.indexColor,
      "line-opacity": c.indexOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, c.indexWidth.z4, 14, c.indexWidth.z14],
    },
  }, beforeId)

  // Labels
  map.addLayer({
    id: CONTOUR_TEST_LABEL,
    type: "symbol",
    source: CONTOUR_TEST_SOURCE,
    "source-layer": "contours",
    minzoom: 12,
    filter: ["==", ["get", "tier"], "index"],
    layout: {
      "text-field": ["concat", ["to-string", ["get", "elevation_ft"]], ""],
      "text-size": c.labelSize,
      "text-font": c.labelFont,
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 400,
      "text-max-angle": 30,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": c.labelColor,
      "text-halo-color": c.labelHaloColor,
      "text-halo-width": c.labelHaloWidth,
      "text-opacity": c.labelOpacity,
    },
  })
}

/** Remove TEST contour layers + source */
function removeContoursTest(map) {
  if (!map) return
  if (map.getLayer(CONTOUR_TEST_LABEL)) map.removeLayer(CONTOUR_TEST_LABEL)
  if (map.getLayer(CONTOUR_TEST_INDEX)) map.removeLayer(CONTOUR_TEST_INDEX)
  if (map.getLayer(CONTOUR_TEST_INTERMEDIATE)) map.removeLayer(CONTOUR_TEST_INTERMEDIATE)
  if (map.getLayer(CONTOUR_TEST_MINOR)) map.removeLayer(CONTOUR_TEST_MINOR)
  if (map.getSource(CONTOUR_TEST_SOURCE)) map.removeSource(CONTOUR_TEST_SOURCE)
}

/** Add TEST 10ft topographic contour overlay (green color scheme) */
function addContoursTest10ft(map, themeId) {
  if (!map || map.getSource(CONTOUR_TEST_10FT_SOURCE)) return

  const c = getOverlayConfig(themeId, 'contoursTest10ft')

  map.addSource(CONTOUR_TEST_10FT_SOURCE, {
    type: "vector",
    url: "pmtiles:///tiles/contours-test-10ft.pmtiles",
  })

  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol") {
      beforeId = layer.id
      break
    }
  }

  // Minor contours (10ft) — green scheme
  map.addLayer({
    id: CONTOUR_TEST_10FT_MINOR,
    type: "line",
    source: CONTOUR_TEST_10FT_SOURCE,
    "source-layer": "contours",
    minzoom: 11,
    filter: ["==", ["get", "tier"], "minor"],
    paint: {
      "line-color": c.minorColor,
      "line-opacity": c.minorOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, c.minorWidth.z11, 14, c.minorWidth.z14],
    },
  }, beforeId)

  // Intermediate contours (50ft) — green scheme
  map.addLayer({
    id: CONTOUR_TEST_10FT_INTERMEDIATE,
    type: "line",
    source: CONTOUR_TEST_10FT_SOURCE,
    "source-layer": "contours",
    minzoom: 8,
    filter: ["==", ["get", "tier"], "intermediate"],
    paint: {
      "line-color": c.intermediateColor,
      "line-opacity": c.intermediateOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, c.intermediateWidth.z8, 14, c.intermediateWidth.z14],
    },
  }, beforeId)

  // Index contours (250ft) — darker green
  map.addLayer({
    id: CONTOUR_TEST_10FT_INDEX,
    type: "line",
    source: CONTOUR_TEST_10FT_SOURCE,
    "source-layer": "contours",
    minzoom: 4,
    filter: ["==", ["get", "tier"], "index"],
    paint: {
      "line-color": c.indexColor,
      "line-opacity": c.indexOpacity * c.opacityMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, c.indexWidth.z4, 14, c.indexWidth.z14],
    },
  }, beforeId)

  // Elevation labels on index contours (z12+)
  map.addLayer({
    id: CONTOUR_TEST_10FT_LABEL,
    type: "symbol",
    source: CONTOUR_TEST_10FT_SOURCE,
    "source-layer": "contours",
    minzoom: 12,
    filter: ["==", ["get", "tier"], "index"],
    layout: {
      "text-field": ["concat", ["to-string", ["get", "elevation_ft"]], "'"],
      "text-size": c.labelSize,
      "text-font": c.labelFont,
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 400,
      "text-max-angle": 30,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": c.labelColor,
      "text-halo-color": c.labelHaloColor,
      "text-halo-width": c.labelHaloWidth,
      "text-opacity": c.labelOpacity,
    },
  })
}

/** Remove test 10ft contour layers + source */
function removeContoursTest10ft(map) {
  if (!map) return
  if (map.getLayer(CONTOUR_TEST_10FT_LABEL)) map.removeLayer(CONTOUR_TEST_10FT_LABEL)
  if (map.getLayer(CONTOUR_TEST_10FT_INDEX)) map.removeLayer(CONTOUR_TEST_10FT_INDEX)
  if (map.getLayer(CONTOUR_TEST_10FT_INTERMEDIATE)) map.removeLayer(CONTOUR_TEST_10FT_INTERMEDIATE)
  if (map.getLayer(CONTOUR_TEST_10FT_MINOR)) map.removeLayer(CONTOUR_TEST_10FT_MINOR)
  if (map.getSource(CONTOUR_TEST_10FT_SOURCE)) map.removeSource(CONTOUR_TEST_10FT_SOURCE)
}
/** Add USFS trails and roads vector tile overlay */
function addUsfsTrails(map, themeId) {
  if (!map || map.getSource(USFS_SOURCE)) return

  const c = getOverlayConfig(themeId, 'usfsTrails')

  map.addSource(USFS_SOURCE, {
    type: "vector",
    url: "pmtiles:///tiles/usfs-trails-roads.pmtiles",
  })

  // Insert below first symbol layer
  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol") {
      beforeId = layer.id
      break
    }
  }

  // Invisible hit-area layers for easier clicking
  map.addLayer({
    id: USFS_ROADS_HIT,
    type: "line",
    source: USFS_SOURCE,
    "source-layer": "roads",
    minzoom: 10,
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      "line-width": c.hitWidth,
    },
  }, beforeId)

  map.addLayer({
    id: USFS_TRAILS_HIT,
    type: "line",
    source: USFS_SOURCE,
    "source-layer": "trails",
    minzoom: 10,
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      "line-width": c.hitWidth,
    },
  }, beforeId)

  // Roads layer - solid amber/tan line
  map.addLayer({
    id: USFS_ROADS_LAYER,
    type: "line",
    source: USFS_SOURCE,
    "source-layer": "roads",
    minzoom: 10,
    paint: {
      "line-color": c.roadsColor,
      "line-opacity": c.roadsOpacity,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, c.roadsWidth.z10, 14, c.roadsWidth.z14, 16, c.roadsWidth.z16],
    },
  }, beforeId)

  // Trails layer - color by allowed use
  map.addLayer({
    id: USFS_TRAILS_LAYER,
    type: "line",
    source: USFS_SOURCE,
    "source-layer": "trails",
    minzoom: 10,
    paint: {
      "line-color": [
        "case",
        // Motorcycle/ATV trails - orange
        ["any",
          ["==", ["slice", ["get", "MOTORCYCLE"], 0, 1], "0"],
          ["==", ["slice", ["get", "ATV_MANAGE"], 0, 1], "0"]
        ], c.trailsMotorized,
        // Bike trails - amber
        ["==", ["slice", ["get", "BICYCLE_MA"], 0, 1], "0"],
        c.trailsBicycle,
        // Hiker/Horse only - green
        ["any",
          ["==", ["slice", ["get", "HIKER_PEDE"], 0, 1], "0"],
          ["==", ["slice", ["get", "HORSE_MANA"], 0, 1], "0"]
        ], c.trailsHiker,
        // Default - tan
        c.trailsDefault
      ],
      "line-opacity": c.trailsOpacity,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, c.trailsWidth.z10, 14, c.trailsWidth.z14, 16, c.trailsWidth.z16],
      "line-dasharray": c.trailsDash,
    },
  }, beforeId)

  // Road labels (zoom 12+)
  map.addLayer({
    id: USFS_ROADS_LABEL,
    type: "symbol",
    source: USFS_SOURCE,
    "source-layer": "roads",
    minzoom: 12,
    filter: ["has", "NAME"],
    layout: {
      "text-field": ["get", "NAME"],
      "text-size": c.roadsLabelSize,
      "text-font": c.labelFont,
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 300,
      "text-max-angle": 25,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": c.roadsLabelColor,
      "text-halo-color": c.roadsLabelHaloColor,
      "text-halo-width": c.roadsLabelHaloWidth,
      "text-opacity": c.roadsLabelOpacity,
    },
  })

  // Trail labels (zoom 12+)
  map.addLayer({
    id: USFS_TRAILS_LABEL,
    type: "symbol",
    source: USFS_SOURCE,
    "source-layer": "trails",
    minzoom: 12,
    filter: ["has", "TRAIL_NAME"],
    layout: {
      "text-field": ["get", "TRAIL_NAME"],
      "text-size": c.trailsLabelSize,
      "text-font": c.labelFont,
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 300,
      "text-max-angle": 25,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": c.trailsLabelColor,
      "text-halo-color": c.trailsLabelHaloColor,
      "text-halo-width": c.trailsLabelHaloWidth,
      "text-opacity": c.trailsLabelOpacity,
    },
  })

  // Cursor pointer on hover
  ;[USFS_TRAILS_HIT, USFS_ROADS_HIT].forEach(layerId => {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer"
    })
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = ""
    })
  })
}
function removeUsfsTrails(map) {
  if (!map) return
  if (map.getLayer(USFS_TRAILS_LABEL)) map.removeLayer(USFS_TRAILS_LABEL)
  if (map.getLayer(USFS_ROADS_LABEL)) map.removeLayer(USFS_ROADS_LABEL)
  if (map.getLayer(USFS_TRAILS_LAYER)) map.removeLayer(USFS_TRAILS_LAYER)
  if (map.getLayer(USFS_ROADS_LAYER)) map.removeLayer(USFS_ROADS_LAYER)
  if (map.getLayer(USFS_TRAILS_HIT)) map.removeLayer(USFS_TRAILS_HIT)
  if (map.getLayer(USFS_ROADS_HIT)) map.removeLayer(USFS_ROADS_HIT)
  if (map.getSource(USFS_SOURCE)) map.removeSource(USFS_SOURCE)
}
/** Add BLM trails/roads vector tile overlay with surface-type styling */
function addBlmTrails(map, themeId) {
  if (!map || map.getSource(BLM_SOURCE)) return

  const c = getOverlayConfig(themeId, 'blmTrails')

  map.addSource(BLM_SOURCE, {
    type: "vector",
    url: "pmtiles:///tiles/blm-trails-roads.pmtiles",
  })

  // Insert below first symbol layer
  let beforeId = undefined
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol") {
      beforeId = layer.id
      break
    }
  }

  // Color expression based on route use class
  const colorExpr = [
    "case",
    ["any",
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4WD HIGH CLEARANCE / SPECIALIZED"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4WD High Clearance/Specialized"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4wd High Clearance / Specialized"]
    ], c.color4wdHigh,
    ["any",
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4WD LOW"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4WD Low"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "4wd Low"]
    ], c.color4wdLow,
    ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "ATV"],
    c.colorAtv,
    ["any",
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "MOTORIZED SINGLE TRACK"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "Motorized Single Track"]
    ], c.colorMotoSingle,
    ["any",
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "2WD LOW"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "2WD Low"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "2wd Low"]
    ], c.color2wdLow,
    ["any",
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "NON-MECHANIZED"],
      ["==", ["get", "OBSRVE_ROUTE_USE_CLASS"], "Non-Mechanized"]
    ], c.colorNonMech,
    c.colorDefault
  ]

  const lineWidth = ["interpolate", ["linear"], ["zoom"], 10, c.lineWidth.z10, 14, c.lineWidth.z14, 16, c.lineWidth.z16]

  // Filter out paved, arterial, collector, local, and highways
  const excludeUrban = [
    "all",
    // Exclude paved
    ["!=", ["get", "OBSRVE_SRFCE_TYPE"], "SOLID SURFACE"],
    ["!=", ["get", "OBSRVE_SRFCE_TYPE"], "Solid Surface"],
    // Exclude arterial roads
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "ARTERIAL"],
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "Arterial"],
    // Exclude collector roads
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "COLLECTOR"],
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "Collector"],
    // Exclude local roads
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "LOCAL"],
    ["!=", ["get", "OBSRVE_FUNC_CLASS"], "Local"],
    // Exclude designated highways
    ["!", ["has", "HWY_CLASS"]]
  ]

  // Invisible hit-area layer for clicking
  map.addLayer({
    id: BLM_ROUTES_HIT,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: excludeUrban,
    paint: {
      "line-color": "#000000",
      "line-opacity": 0,
      "line-width": c.hitWidth,
    },
  }, beforeId)

  // NATURAL surface - solid line
  map.addLayer({
    id: BLM_ROUTES_NATURAL,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: ["all", excludeUrban,
      ["any",
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "NATURAL"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Natural"]
      ]
    ],
    paint: {
      "line-color": colorExpr,
      "line-opacity": c.lineOpacity,
      "line-width": lineWidth,
    },
  }, beforeId)

  // NATURAL IMPROVED surface - dashed
  map.addLayer({
    id: BLM_ROUTES_IMPROVED,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: ["all", excludeUrban,
      ["any",
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "NATURAL IMPROVED"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Natural Improved"]
      ]
    ],
    paint: {
      "line-color": colorExpr,
      "line-opacity": c.lineOpacity,
      "line-width": lineWidth,
      "line-dasharray": c.dashImproved,
    },
  }, beforeId)

  // AGGREGATE surface - dotted
  map.addLayer({
    id: BLM_ROUTES_AGGREGATE,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: ["all", excludeUrban,
      ["any",
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "AGGREGATE"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Aggregate"]
      ]
    ],
    paint: {
      "line-color": colorExpr,
      "line-opacity": c.lineOpacity,
      "line-width": lineWidth,
      "line-dasharray": c.dashAggregate,
    },
  }, beforeId)

  // SNOW surface - dash-dot, blue
  map.addLayer({
    id: BLM_ROUTES_SNOW,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: ["all", excludeUrban,
      ["any",
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "SNOW"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Snow"]
      ]
    ],
    paint: {
      "line-color": c.colorSnow,
      "line-opacity": c.lineOpacity,
      "line-width": lineWidth,
      "line-dasharray": c.dashSnow,
    },
  }, beforeId)

  // OTHER/UNKNOWN surface - dash-dot-dot
  map.addLayer({
    id: BLM_ROUTES_OTHER,
    type: "line",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 10,
    filter: ["all", excludeUrban,
      ["!", ["any",
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "NATURAL"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Natural"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "NATURAL IMPROVED"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Natural Improved"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "AGGREGATE"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Aggregate"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "SNOW"],
        ["==", ["get", "OBSRVE_SRFCE_TYPE"], "Snow"]
      ]]
    ],
    paint: {
      "line-color": colorExpr,
      "line-opacity": c.lineOpacityOther,
      "line-width": lineWidth,
      "line-dasharray": c.dashOther,
    },
  }, beforeId)

  // Route labels (zoom 12+)
  map.addLayer({
    id: BLM_ROUTES_LABEL,
    type: "symbol",
    source: BLM_SOURCE,
    "source-layer": "blm_routes",
    minzoom: 12,
    filter: ["all", excludeUrban, ["has", "ROUTE_PRMRY_NM"]],
    layout: {
      "text-field": ["get", "ROUTE_PRMRY_NM"],
      "text-size": c.labelSize,
      "text-font": c.labelFont,
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 300,
      "text-max-angle": 25,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": c.labelColor,
      "text-halo-color": c.labelHaloColor,
      "text-halo-width": c.labelHaloWidth,
      "text-opacity": c.labelOpacity,
    },
  })

  // Cursor pointer on hover
  map.on("mouseenter", BLM_ROUTES_HIT, () => {
    map.getCanvas().style.cursor = "pointer"
  })
  map.on("mouseleave", BLM_ROUTES_HIT, () => {
    map.getCanvas().style.cursor = ""
  })
}

/** Remove BLM trails/roads layers and source */
function removeBlmTrails(map) {
  if (!map) return
  if (map.getLayer(BLM_ROUTES_LABEL)) map.removeLayer(BLM_ROUTES_LABEL)
  if (map.getLayer(BLM_ROUTES_OTHER)) map.removeLayer(BLM_ROUTES_OTHER)
  if (map.getLayer(BLM_ROUTES_SNOW)) map.removeLayer(BLM_ROUTES_SNOW)
  if (map.getLayer(BLM_ROUTES_AGGREGATE)) map.removeLayer(BLM_ROUTES_AGGREGATE)
  if (map.getLayer(BLM_ROUTES_IMPROVED)) map.removeLayer(BLM_ROUTES_IMPROVED)
  if (map.getLayer(BLM_ROUTES_NATURAL)) map.removeLayer(BLM_ROUTES_NATURAL)
  if (map.getLayer(BLM_ROUTES_HIT)) map.removeLayer(BLM_ROUTES_HIT)
  if (map.getSource(BLM_SOURCE)) map.removeSource(BLM_SOURCE)
}


// ═══════════════════════════════════════════════════════════════════════════
// SATELLITE IMAGERY
// ═══════════════════════════════════════════════════════════════════════════

/** Add satellite raster source (called once on map load) */
function addSatelliteSource(map) {
  if (!map || map.getSource(SATELLITE_SOURCE)) return
  map.addSource(SATELLITE_SOURCE, {
    type: 'raster',
    tiles: ['/tiles/satellite/{z}/{x}/{y}'],
    tileSize: 256,
    maxzoom: 18,
    attribution: '© Esri',
  })
}

/** Add satellite raster layer with theme-specific styling */
function addSatelliteLayer(map, themeId) {
  if (!map) return
  if (map.getLayer(SATELLITE_LAYER)) return
  if (!map.getSource(SATELLITE_SOURCE)) {
    addSatelliteSource(map)
  }
  
  const theme = getTheme(themeId)
  const sat = theme.satellite || {}
  
  // Find the first layer to insert below (we want satellite at the bottom)
  const layers = map.getStyle().layers
  let firstLayerId = layers.length > 0 ? layers[0].id : undefined
  
  map.addLayer({
    id: SATELLITE_LAYER,
    type: 'raster',
    source: SATELLITE_SOURCE,
    paint: {
      'raster-opacity': sat.opacity ?? 1.0,
      'raster-brightness-min': sat.brightnessMin ?? 0.0,
      'raster-brightness-max': sat.brightnessMax ?? 1.0,
      'raster-contrast': sat.contrast ?? 0.0,
      'raster-saturation': sat.saturation ?? 0.0,
      'raster-hue-rotate': sat.hueRotate ?? 0,
    },
  }, firstLayerId)
}

/** Remove satellite raster layer */
function removeSatelliteLayer(map) {
  if (!map) return
  if (map.getLayer(SATELLITE_LAYER)) {
    map.removeLayer(SATELLITE_LAYER)
  }
}

/** Update satellite layer paint properties for current theme */
function updateSatellitePaint(map, themeId) {
  if (!map || !map.getLayer(SATELLITE_LAYER)) return
  
  const theme = getTheme(themeId)
  const sat = theme.satellite || {}
  
  map.setPaintProperty(SATELLITE_LAYER, 'raster-opacity', sat.opacity ?? 1.0)
  map.setPaintProperty(SATELLITE_LAYER, 'raster-brightness-min', sat.brightnessMin ?? 0.0)
  map.setPaintProperty(SATELLITE_LAYER, 'raster-brightness-max', sat.brightnessMax ?? 1.0)
  map.setPaintProperty(SATELLITE_LAYER, 'raster-contrast', sat.contrast ?? 0.0)
  map.setPaintProperty(SATELLITE_LAYER, 'raster-saturation', sat.saturation ?? 0.0)
  map.setPaintProperty(SATELLITE_LAYER, 'raster-hue-rotate', sat.hueRotate ?? 0)
}

// Track which vector layers are hidden in satellite/hybrid mode
// Track hidden layers for each mode - separate arrays for proper restoration
let hiddenFillLayers = []
let hiddenLineLayers = []
let hiddenSymbolLayers = []

// Layers we never hide (our own overlays)
function isProtectedLayer(id) {
  return id.startsWith('public-lands') ||
         id.startsWith('boundary') ||
         id.startsWith('route') ||
         id.startsWith('measure') ||
         id.startsWith('contour') ||
         id.startsWith('usfs') ||
         id.startsWith('blm') ||
         id.startsWith('hillshade') ||
         id.startsWith('traffic') ||
         id === SATELLITE_LAYER
}

/** Hide a layer and track it */
function hideLayer(map, layerId, trackingArray) {
  if (!map.getLayer(layerId)) return
  const vis = map.getLayoutProperty(layerId, 'visibility')
  if (vis !== 'none') {
    trackingArray.push(layerId)
    map.setLayoutProperty(layerId, 'visibility', 'none')
  }
}

/** Show all layers in a tracking array */
function showLayers(map, trackingArray) {
  for (const id of trackingArray) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'visible')
    }
  }
  trackingArray.length = 0
}

/** Set map to satellite-only mode - hide ALL vector layers except our overlays */
function setSatelliteMode(map, themeId) {
  if (!map) return
  
  // First restore any previously hidden layers to clean slate
  showLayers(map, hiddenFillLayers)
  showLayers(map, hiddenLineLayers)
  showLayers(map, hiddenSymbolLayers)
  
  addSatelliteLayer(map, themeId)
  
  const style = map.getStyle()
  if (!style?.layers) return
  
  for (const layer of style.layers) {
    if (isProtectedLayer(layer.id)) continue
    
    if (layer.type === 'fill' || layer.type === 'fill-extrusion' || layer.type === 'background') {
      hideLayer(map, layer.id, hiddenFillLayers)
    } else if (layer.type === 'line') {
      hideLayer(map, layer.id, hiddenLineLayers)
    } else if (layer.type === 'symbol') {
      hideLayer(map, layer.id, hiddenSymbolLayers)
    }
  }
  
  console.log('[Satellite] Hidden:', hiddenFillLayers.length, 'fills,', hiddenLineLayers.length, 'lines,', hiddenSymbolLayers.length, 'symbols')
}

/** Set map to hybrid mode - satellite + roads + labels */
function setHybridMode(map, themeId) {
  if (!map) return
  
  // First restore any previously hidden layers to clean slate
  showLayers(map, hiddenFillLayers)
  showLayers(map, hiddenLineLayers)
  showLayers(map, hiddenSymbolLayers)
  
  addSatelliteLayer(map, themeId)
  
  const style = map.getStyle()
  if (!style?.layers) return
  
  // In hybrid: hide fills/background, keep lines and symbols visible
  for (const layer of style.layers) {
    if (isProtectedLayer(layer.id)) continue
    
    if (layer.type === 'fill' || layer.type === 'fill-extrusion' || layer.type === 'background') {
      hideLayer(map, layer.id, hiddenFillLayers)
    }
    // Lines and symbols stay visible for hybrid mode
  }
  
  console.log('[Hybrid] Hidden:', hiddenFillLayers.length, 'fills, keeping lines and symbols visible')
}

/** Set map back to normal map mode */
function setMapMode(map) {
  if (!map) return
  
  removeSatelliteLayer(map)
  
  // Restore all hidden layers
  showLayers(map, hiddenFillLayers)
  showLayers(map, hiddenLineLayers)
  showLayers(map, hiddenSymbolLayers)
  
  console.log('[Map] Restored all vector layers')
}


/** Add boundary polygon layers with computed accent color (MapLibre rejects CSS vars in paint) */
const BOUNDARY_FILL_LAYER = 'boundary-fill-layer'

function addBoundaryLayer(map) {
  if (!map || map.getLayer(BOUNDARY_LAYER)) return
  if (!map.getSource(BOUNDARY_SOURCE)) {
    map.addSource(BOUNDARY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    })
  }
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7a9a6b"

  // Find first symbol layer to insert boundary layers below labels
  const layers = map.getStyle().layers
  let firstSymbolId = null
  for (const layer of layers) {
    if (layer.type === 'symbol') {
      firstSymbolId = layer.id
      break
    }
  }

  // Add subtle fill layer (barely visible tint)
  map.addLayer({
    id: BOUNDARY_FILL_LAYER,
    type: "fill",
    source: BOUNDARY_SOURCE,
    paint: {
      "fill-color": accentColor,
      "fill-opacity": 0.05,
    },
  }, firstSymbolId)

  // Add dashed outline layer
  map.addLayer({
    id: BOUNDARY_LAYER,
    type: "line",
    source: BOUNDARY_SOURCE,
    paint: {
      "line-color": accentColor,
      "line-width": 2,
      "line-opacity": 0.7,
      "line-dasharray": [3, 2],
    },
  }, firstSymbolId)
}

const MapView = forwardRef(function MapView(_, ref) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])
  const popupRef = useRef(null)
  const gpsMarkerRef = useRef(null)
  const previewMarkerRef = useRef(null)
  const watchIdRef = useRef(null)
  const currentThemeRef = useRef('dark')
  // Track which overlay layers are currently active (for theme swap re-add)
  const activeLayersRef = useRef({ hillshade: false, traffic: false, contours: false, contoursTest: false, contoursTest10ft: false, usfsTrails: false, blmTrails: false })
  // Flag to suppress map-click when a stop pin was clicked
  const pinClickedRef = useRef(false)
  const highlightedFeatureRef = useRef(null) // { source, sourceLayer, id } for setFeatureState
  const hoveredFeatureRef = useRef(null) // for hover highlight
  const updateBoundaryRef = useRef(null) // boundary update function
  // Refs for measurement state (accessible in click handlers)
  const measuringRef = useRef({ active: false, points: [] })
  const measureLabelsRef = useRef([]) // HTML label elements

  const stops = useStore((s) => s.stops)
  const route = useStore((s) => s.route)
  const theme = useStore((s) => s.theme)
  const selectedPlace = useStore((s) => s.selectedPlace)
  const clickMarker = useStore((s) => s.clickMarker)
  const setClickMarker = useStore((s) => s.setClickMarker)
  const clearClickMarker = useStore((s) => s.clearClickMarker)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const geoPermission = useStore((s) => s.geoPermission)
  const setSheetState = useStore((s) => s.setSheetState)
  const setMapCenter = useStore((s) => s.setMapCenter)
  const pickingLocationFor = useStore((s) => s.pickingLocationFor)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const clearPickingLocationFor = useStore((s) => s.clearPickingLocationFor)

  // Zoom level indicator state
  const [zoomLevel, setZoomLevel] = useState(10)

  // Radial menu state
  const [radialMenu, setRadialMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    lat: 0,
    lon: 0,
    centerLabel: null,
  })
  // Measurement mode state (for UI rendering)
  const [measuring, setMeasuring] = useState({ active: false, points: [], totalMeters: 0 })

  // Sync state to ref for click handler access
  const updateMeasuringState = (newState) => {
    measuringRef.current = newState
    setMeasuring(newState)
  }

  // Update measurement layer with current points
  const updateMeasureLayer = (points) => {
    const map = mapInstance.current
    if (!map || !map.getSource(MEASURE_SOURCE)) return

    const features = []
    // Add points
    points.forEach((p, i) => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { index: i },
      })
    })
    // Add line if more than one point
    if (points.length > 1) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lon, p.lat]),
        },
        properties: {},
      })
    }
    map.getSource(MEASURE_SOURCE).setData({
      type: "FeatureCollection",
      features,
    })
  }

  // Update segment labels (HTML overlays)
  const updateMeasureLabels = (points) => {
    const map = mapInstance.current
    if (!map) return

    // Remove old labels
    measureLabelsRef.current.forEach(el => el.remove())
    measureLabelsRef.current = []

    if (points.length < 2) return

    const container = mapRef.current
    if (!container) return

    // Create label for each segment
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1]
      const p2 = points[i]
      const midLat = (p1.lat + p2.lat) / 2
      const midLon = (p1.lon + p2.lon) / 2
      const dist = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon)

      const label = document.createElement('div')
      label.className = 'measure-label'
      label.textContent = formatDistance(dist)
      label.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.75);
        color: white;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
        pointer-events: none;
        white-space: nowrap;
        z-index: 100;
        transform: translate(-50%, -50%);
      `

      const pos = map.project([midLon, midLat])
      label.style.left = pos.x + 'px'
      label.style.top = pos.y + 'px'

      container.appendChild(label)
      measureLabelsRef.current.push(label)
    }
  }

  // Reposition labels on map move/zoom
  const repositionLabels = () => {
    const map = mapInstance.current
    const points = measuringRef.current.points
    if (!map || points.length < 2) return

    measureLabelsRef.current.forEach((label, i) => {
      if (i >= points.length - 1) return
      const p1 = points[i]
      const p2 = points[i + 1]
      const midLat = (p1.lat + p2.lat) / 2
      const midLon = (p1.lon + p2.lon) / 2
      const pos = map.project([midLon, midLat])
      label.style.left = pos.x + 'px'
      label.style.top = pos.y + 'px'
    })
  }

  // Clear measurement mode completely
  const clearMeasuring = () => {
    const map = mapInstance.current
    updateMeasuringState({ active: false, points: [], totalMeters: 0 })

    // Remove labels
    measureLabelsRef.current.forEach(el => el.remove())
    measureLabelsRef.current = []

    if (map) {
      map.getCanvas().style.cursor = ""
      map.doubleClickZoom.enable()
      if (map.getLayer(MEASURE_LINE_LAYER)) map.removeLayer(MEASURE_LINE_LAYER)
      if (map.getLayer(MEASURE_POINT_LAYER)) map.removeLayer(MEASURE_POINT_LAYER)
      if (map.getSource(MEASURE_SOURCE)) map.removeSource(MEASURE_SOURCE)
    }
  }

  // End measurement (keep line visible, exit active mode)
  const endMeasuring = () => {
    const map = mapInstance.current
    if (map) {
      map.getCanvas().style.cursor = ""
      map.doubleClickZoom.enable()
    }
    updateMeasuringState({ ...measuringRef.current, active: false })
  }

  // Start new measurement
  const startMeasuring = (lat, lon) => {
    const map = mapInstance.current
    if (!map) return

    // Clear any existing measurement first
    measureLabelsRef.current.forEach(el => el.remove())
    measureLabelsRef.current = []
    if (map.getLayer(MEASURE_LINE_LAYER)) map.removeLayer(MEASURE_LINE_LAYER)
    if (map.getLayer(MEASURE_POINT_LAYER)) map.removeLayer(MEASURE_POINT_LAYER)
    if (map.getSource(MEASURE_SOURCE)) map.removeSource(MEASURE_SOURCE)

    // Set up new measurement
    updateMeasuringState({ active: true, points: [{ lat, lon }], totalMeters: 0 })
    map.getCanvas().style.cursor = "crosshair"
    map.doubleClickZoom.disable()

    // Add source and layers
    map.addSource(MEASURE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    })
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7a9a6b"
    map.addLayer({
      id: MEASURE_LINE_LAYER,
      type: "line",
      source: MEASURE_SOURCE,
      paint: {
        "line-color": accentColor,
        "line-width": 2,
        "line-dasharray": [8, 4],
      },
    })
    map.addLayer({
      id: MEASURE_POINT_LAYER,
      type: "circle",
      source: MEASURE_SOURCE,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": accentColor,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#1a1a1a",
      },
    })
    updateMeasureLayer([{ lat, lon }])
  }

  // Add a point to the measurement
  const addMeasurePoint = (lat, lon) => {
    const current = measuringRef.current
    if (!current.active) return

    const newPoints = [...current.points, { lat, lon }]

    // Calculate total distance
    let totalMeters = 0
    for (let i = 1; i < newPoints.length; i++) {
      totalMeters += haversineDistance(
        newPoints[i - 1].lat, newPoints[i - 1].lon,
        newPoints[i].lat, newPoints[i].lon
      )
    }

    updateMeasuringState({ active: true, points: newPoints, totalMeters })
    updateMeasureLayer(newPoints)
    updateMeasureLabels(newPoints)
  }

  const radialWedges = [
    {
      id: "directions-to",
      label: "To here",
      icon: ArrowDownLeft,
      onSelect: () => {
        setRadialMenu((m) => ({ ...m, open: false }))
        const place = {
          lat: radialMenu.lat,
          lon: radialMenu.lon,
          name: radialMenu.centerLabel || radialMenu.lat.toFixed(5) + ", " + radialMenu.lon.toFixed(5),
          source: "radial_menu",
          matchCode: null,
        }
        useStore.getState().startDirections(place)
      },
    },
    {
      id: "directions-from",
      label: "From here",
      icon: ArrowUpRight,
      onSelect: () => {
        setRadialMenu((m) => ({ ...m, open: false }))
        const { clearStops, addStop } = useStore.getState()
        clearStops()
        const place = {
          lat: radialMenu.lat,
          lon: radialMenu.lon,
          name: radialMenu.centerLabel || radialMenu.lat.toFixed(5) + ", " + radialMenu.lon.toFixed(5),
          source: "radial_menu",
          matchCode: null,
        }
        addStop(place)
        useStore.setState({ gpsOrigin: false })
      },
    },
    {
      id: "add-stop",
      label: "Add stop",
      icon: Plus,
      onSelect: () => {
        setRadialMenu((m) => ({ ...m, open: false }))
        const { stops, addStop, clearStops } = useStore.getState()
        const place = {
          lat: radialMenu.lat,
          lon: radialMenu.lon,
          name: radialMenu.centerLabel || radialMenu.lat.toFixed(5) + ", " + radialMenu.lon.toFixed(5),
          source: "radial_menu",
          matchCode: null,
        }
        if (stops.length === 0) {
          addStop(place)
          useStore.setState({ gpsOrigin: false })
        } else {
          const success = addStop(place)
          if (!success) {
            toast("Maximum 10 stops reached")
          }
        }
      },
    },
    {
      id: "save-place",
      label: "Save",
      icon: Star,
      requiresAuth: true,
      onSelect: () => {
        setRadialMenu((m) => ({ ...m, open: false }))
        const { auth, setEditingContact } = useStore.getState()
        if (auth.authenticated) {
          setEditingContact({
            label: "",
            lat: radialMenu.lat,
            lon: radialMenu.lon,
          })
        } else {
          toast("Log in to save places")
        }
      },
    },
    {
      id: "measure",
      label: "Measure",
      icon: Ruler,
      onSelect: () => {
        setRadialMenu((m) => ({ ...m, open: false }))
        startMeasuring(radialMenu.lat, radialMenu.lon)
      },
    },
  ]
  // Context menu trigger handler
  const handleContextMenuTrigger = ({ x, y }) => {
    const map = mapInstance.current
    if (!map || !mapRef.current) return

    // Suppress context menu during measurement mode
    if (measuringRef.current.active) return

    // Convert screen coords to lat/lon
    const rect = mapRef.current.getBoundingClientRect()
    const lngLat = map.unproject([x - rect.left, y - rect.top])

    setRadialMenu({
      open: true,
      x,
      y,
      lat: lngLat.lat,
      lon: lngLat.lng,
      centerLabel: null,
    })

    // Async reverse geocode for center label
    fetchReverse(lngLat.lat, lngLat.lng).then((place) => {
      if (place) {
        setRadialMenu((m) => {
          if (m.open && Math.abs(m.lat - lngLat.lat) < 0.00001) {
            return { ...m, centerLabel: place.name }
          }
          return m
        })
      }
    })
  }

  // Context menu hook
  const contextMenuHandlers = useContextMenu(handleContextMenuTrigger)

    useImperativeHandle(ref, () => ({
    flyTo(lat, lon, zoom = 14) {
      mapInstance.current?.flyTo({ center: [lon, lat], zoom })
    },
    getMap() {
      return mapInstance.current
    },
    addHillshadeLayer() {
      const map = mapInstance.current
      if (!map) return
      addHillshade(map, currentThemeRef.current)
      activeLayersRef.current.hillshade = true
    },
    removeHillshadeLayer() {
      const map = mapInstance.current
      if (!map) return
      removeHillshade(map)
      activeLayersRef.current.hillshade = false
    },
    addTrafficLayer() {
      const map = mapInstance.current
      if (!map) return
      addTraffic(map, currentThemeRef.current)
      activeLayersRef.current.traffic = true
    },
    removeTrafficLayer() {
      const map = mapInstance.current
      if (!map) return
      removeTraffic(map)
      activeLayersRef.current.traffic = false
    },
    addPublicLandsLayer() {
      const map = mapInstance.current
      if (!map) return
      addPublicLands(map, currentThemeRef.current)
      activeLayersRef.current.publicLands = true
    },
    removePublicLandsLayer() {
      const map = mapInstance.current
      if (!map) return
      removePublicLands(map)
      activeLayersRef.current.publicLands = false
    },
    addContoursLayer() {
      const map = mapInstance.current
      if (!map) return
      addContours(map, currentThemeRef.current)
      activeLayersRef.current.contours = true
    },
    removeContoursLayer() {
      const map = mapInstance.current
      if (!map) return
      removeContours(map)
      activeLayersRef.current.contours = false
    },
    addContoursTestLayer() {
      const map = mapInstance.current
      if (!map) return
      addContoursTest(map, currentThemeRef.current)
      activeLayersRef.current.contoursTest = true
    },
    removeContoursTestLayer() {
      const map = mapInstance.current
      if (!map) return
      removeContoursTest(map)
      activeLayersRef.current.contoursTest = false
    },
    addContoursTest10ftLayer() {
      const map = mapInstance.current
      if (!map) return
      addContoursTest10ft(map, currentThemeRef.current)
      activeLayersRef.current.contoursTest10ft = true
    },
    removeContoursTest10ftLayer() {
      const map = mapInstance.current
      if (!map) return
      removeContoursTest10ft(map)
      activeLayersRef.current.contoursTest10ft = false
    },
    addUsfsTrailsLayer() {
      const map = mapInstance.current
      if (!map) return
      addUsfsTrails(map, currentThemeRef.current)
      activeLayersRef.current.usfsTrails = true
    },
    removeUsfsTrailsLayer() {
      const map = mapInstance.current
      if (!map) return
      removeUsfsTrails(map)
      activeLayersRef.current.usfsTrails = false
    },
    addBlmTrailsLayer() {
      const map = mapInstance.current
      if (!map) return
      addBlmTrails(map, currentThemeRef.current)
      activeLayersRef.current.blmTrails = true
    },
    removeBlmTrailsLayer() {
      const map = mapInstance.current
      if (!map) return
      removeBlmTrails(map)
      activeLayersRef.current.blmTrails = false
    },

    // View mode functions
    setViewMode(mode) {
      const map = mapInstance.current
      if (!map) return
      
      if (mode === 'satellite') {
        setSatelliteMode(map, currentThemeRef.current)
      } else if (mode === 'hybrid') {
        setHybridMode(map, currentThemeRef.current)
      } else {
        setMapMode(map)
      }
    },
    
    updateSatelliteTheme() {
      const map = mapInstance.current
      if (!map) return
      updateSatellitePaint(map, currentThemeRef.current)
    },

  }))

  // Initialize map
  useEffect(() => {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    const config = getConfig()
    const DEFAULT_CENTER = config?.defaults?.center
      ? [config.defaults.center[1], config.defaults.center[0]]  // config is [lat,lon], MapLibre wants [lon,lat]
      : [-114.6066, 42.5736]
    const DEFAULT_ZOOM = config?.defaults?.zoom || 10

    const initialTheme = document.documentElement.getAttribute('data-theme') || 'dark'
    currentThemeRef.current = initialTheme

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: buildStyle(initialTheme),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Scale bar control
    map.addControl(new maplibregl.ScaleControl({
      maxWidth: 120,
      unit: 'imperial',
    }), 'bottom-right')

    // Map click — two-click selection model
    map.on('click', (e) => {
      // If a stop pin was just clicked, skip
      if (pinClickedRef.current) {
        pinClickedRef.current = false
        return
      }

      // CRITICAL: Check measuring mode FIRST using ref (not stale closure)
      if (measuringRef.current.active) {
        const { lng, lat } = e.lngLat
        addMeasurePoint(lat, lng)
        return
      }

      // Handle location pick mode for contacts
      const pickState = useStore.getState().pickingLocationFor
      if (pickState) {
        const { lng, lat } = e.lngLat
        map.getCanvas().style.cursor = ''
        // Reverse geocode for address
        fetchReverse(lat, lng).then((place) => {
          const addr = place?.address || place?.name || ''
          // Rebuild form data with new location
          useStore.getState().setEditingContact({
            ...pickState,
            lat,
            lon: lng,
            address: addr || pickState.address || '',
          })
          useStore.getState().clearPickingLocationFor()
        }).catch(() => {
          // Even if reverse geocode fails, set the location
          useStore.getState().setEditingContact({
            ...pickState,
            lat,
            lon: lng,
          })
          useStore.getState().clearPickingLocationFor()
        })
        return
      }



      const store = useStore.getState()
      const marker = store.clickMarker

      if (marker) {
        // State B: marker present — check if click is inside the circle
        const markerScreen = map.project([marker.lon, marker.lat])
        const dx = e.point.x - markerScreen.x
        const dy = e.point.y - markerScreen.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist <= marker.circleRadiusPx) {
          // Inside circle → open radial at marker location
          const rect = mapRef.current?.getBoundingClientRect()
          const screenX = rect ? markerScreen.x + rect.left : markerScreen.x
          const screenY = rect ? markerScreen.y + rect.top : markerScreen.y

          setRadialMenu({
            open: true,
            x: screenX,
            y: screenY,
            lat: marker.lat,
            lon: marker.lon,
            centerLabel: store.selectedPlace?.name || null,
          })

          // Fetch reverse geocode for center label if not already loaded
          if (!store.selectedPlace?.name || store.selectedPlace.name === 'Dropped pin') {
            fetchReverse(marker.lat, marker.lon).then((place) => {
              if (place) {
                setRadialMenu((m) => {
                  if (m.open && Math.abs(m.lat - marker.lat) < 0.00001) {
                    return { ...m, centerLabel: place.name }
                  }
                  return m
                })
              }
            })
          }
        } else {
          // Outside circle → deselect, no new selection
          store.clearClickMarker()
          store.clearSelectedPlace()
          // Clear boundary when deselecting
          if (updateBoundaryRef.current) updateBoundaryRef.current(null)
          setSelectedHighlight(map, null)
        }
      } else {
        // State A: nothing selected → select
        if (window.innerWidth < 768) setSheetState('collapsed')

        const { lng, lat } = e.lngLat
        const MARKER_RADIUS_PX = 14 // half of 28px preview marker

        // Check for USFS trails/roads click (show info popup)
        const usfsLayers = [USFS_TRAILS_HIT, USFS_ROADS_HIT].filter(id => map.getLayer(id))
        const usfsFeatures = usfsLayers.length > 0
          ? map.queryRenderedFeatures(e.point, { layers: usfsLayers })
          : []
        const usfsFeature = usfsFeatures.find(f => f.properties)
        if (usfsFeature && hasFeature('has_usfs_trails')) {
          const props = usfsFeature.properties
          const isTrail = usfsFeature.layer?.id === USFS_TRAILS_HIT
          const name = isTrail ? (props.TRAIL_NAME || 'Unnamed Trail') : (props.NAME || 'Unnamed Road')
          const typeLabel = isTrail ? 'USFS Trail' : 'USFS Road'

          // Build popup content
          let html = '<div style="font-size:12px;max-width:240px;line-height:1.4">'
          html += '<strong style="font-size:13px">' + name + '</strong>'
          html += '<div style="color:var(--text-secondary);font-size:11px;margin-bottom:4px">' + typeLabel + '</div>'

          if (isTrail) {
            // Trail-specific info
            if (props.TRAIL_TYPE) html += '<div><b>Type:</b> ' + props.TRAIL_TYPE + '</div>'
            if (props.TRAIL_SURF) html += '<div><b>Surface:</b> ' + props.TRAIL_SURF + '</div>'
            if (props.GIS_MILES) html += '<div><b>Length:</b> ' + parseFloat(props.GIS_MILES).toFixed(1) + ' mi</div>'
            // Allowed uses
            const uses = []
            if (props.HIKER_PEDE === 'Y') uses.push('Hiking')
            if (props.BICYCLE_MA === 'Y') uses.push('Biking')
            if (props.MOTORCYCLE === 'Y') uses.push('Motorcycle')
            if (props.ATV_MANAGE === 'Y') uses.push('ATV')
            if (props.HORSE_MANA === 'Y') uses.push('Horse')
            if (uses.length > 0) html += '<div><b>Allowed:</b> ' + uses.join(', ') + '</div>'
          } else {
            // Road-specific info
            if (props.OPER_MAINT) html += '<div><b>Maintenance:</b> ' + props.OPER_MAINT + '</div>'
            if (props.SURFACE_TY) html += '<div><b>Surface:</b> ' + props.SURFACE_TY + '</div>'
            if (props.ROUTE_STAT) html += '<div><b>Status:</b> ' + props.ROUTE_STAT + '</div>'
          }
          html += '</div>'

          // Remove existing popup
          if (popupRef.current) popupRef.current.remove()

          const popup = new maplibregl.Popup({ offset: 10, closeButton: true })
            .setLngLat([lng, lat])
            .setHTML(html)
            .addTo(map)
          popupRef.current = popup
          return
        }

        // Check for BLM routes click (show info popup)
        const blmLayers = [BLM_ROUTES_HIT].filter(id => map.getLayer(id))
        const blmFeatures = blmLayers.length > 0
          ? map.queryRenderedFeatures(e.point, { layers: blmLayers })
          : []
        const blmFeature = blmFeatures.find(f => f.properties)
        if (blmFeature && hasFeature("has_blm_trails")) {
          const props = blmFeature.properties
          const name = props.ROUTE_PRMRY_NM || "Unnamed Route"

          // Build popup content
          let html = "<div style=\"font-size:12px;max-width:240px;line-height:1.4\">"
          html += "<strong style=\"font-size:13px\">" + name + "</strong>"
          html += "<div style=\"color:var(--text-secondary);font-size:11px;margin-bottom:4px\">BLM Route</div>"

          // Route info - handle potential field name variations across states
          if (props.PLAN_ASSET_CLASS) html += "<div><b>Asset Class:</b> " + props.PLAN_ASSET_CLASS + "</div>"
          if (props.PLAN_MODE_TRNSPRT) html += "<div><b>Transport:</b> " + props.PLAN_MODE_TRNSPRT + "</div>"
          if (props.OBSRVE_SRFCE_TYPE) html += "<div><b>Surface:</b> " + props.OBSRVE_SRFCE_TYPE + "</div>"
          if (props.GIS_MILES) html += "<div><b>Length:</b> " + parseFloat(props.GIS_MILES).toFixed(1) + " mi</div>"
          html += "</div>"

          // Remove existing popup
          if (popupRef.current) popupRef.current.remove()

          const popup = new maplibregl.Popup({ offset: 10, closeButton: true })
            .setLngLat([lng, lat])
            .setHTML(html)
            .addTo(map)
          popupRef.current = popup
          return
        }



        // Query rendered features at click point (label/POI priority)
        const labelLayers = ['pois', 'places_subplace', 'places_locality', 'places_region', 'places_country']
        const features = map.queryRenderedFeatures(e.point, { layers: labelLayers })

        // Find first feature with a name (respects layer order = priority)
        const labelFeature = features.find(f => f.properties?.name)

        // Clear previous feature highlight and boundary
          if (highlightedFeatureRef.current) {
            const { source, sourceLayer, id } = highlightedFeatureRef.current
            try {
              map.setFeatureState({ source, sourceLayer, id }, { selected: false })
            } catch (e) { /* ignore if layer removed */ }
            highlightedFeatureRef.current = null
          }
          setSelectedHighlight(map, null)
          // Note: do not clear boundary here - new data replaces old when API returns

          if (labelFeature) {
          // Clicked a labeled feature — snap to geometry and highlight
          const props = labelFeature.properties
          const geom = labelFeature.geometry

          // Get feature coordinates (Point geometry)
          let featureLat = lat
          let featureLon = lng
          if (geom && geom.type === 'Point' && geom.coordinates) {
            featureLon = geom.coordinates[0]
            featureLat = geom.coordinates[1]
          }

          // Apply feature state highlight
          const featureId = labelFeature.id ?? props.mvt_id
          const sourceLayer = labelFeature.sourceLayer
          const source = labelFeature.source
          if (featureId != null && source) {
            try {
              map.setFeatureState({ source, sourceLayer, id: featureId }, { selected: true })
              highlightedFeatureRef.current = { source, sourceLayer, id: featureId }
            } catch (e) { console.warn('setFeatureState error:', e) }
          }

          // Filter-based highlight (works with PMTiles)
          setSelectedHighlight(map, labelFeature)
          setHoverHighlight(map, null)

          // For feature clicks, don't show pin marker
          store.clearClickMarker()

          store.setSelectedPlace({
            lat: featureLat,
            lon: featureLon,
            name: props.name || 'Unknown',
            address: null,
            type: props.kind_detail || props.kind || null,
            source: 'basemap_label',
            matchCode: null,
            mode: 'feature',
            featureId: featureId,
            featureLayer: labelFeature.layer?.id || null,
            wikidata: props.wikidata || null,
            raw: {
              wikidata: props.wikidata || null,
              population: props.population || null,
              kind: props.kind || null,
              kind_detail: props.kind_detail || null,
              elevation: props.elevation || null,
            },
          })
        } else {
          // No labeled feature — show reticle at click point
          // Clear any existing boundary when clicking empty map
          if (updateBoundaryRef.current) updateBoundaryRef.current(null)
          store.setClickMarker({
            lat,
            lon: lng,
            circleRadiusPx: MARKER_RADIUS_PX,
          })

          store.setSelectedPlace({
            lat,
            lon: lng,
            name: 'Dropped pin',
            address: null,
            type: null,
            source: 'map_click',
            matchCode: null,
            mode: 'reticle',
            raw: {},
          })

          // Reverse geocode in background
          fetchReverse(lat, lng).then((place) => {
            if (!place) return
            const current = useStore.getState().selectedPlace
            if (current && Math.abs(current.lat - lat) < 0.00001 && Math.abs(current.lon - lng) < 0.00001) {
              useStore.getState().setSelectedPlace({
                ...place,
                lat,
                lon: lng,
              })
            }
          })
        }
      }
    })

    // Double-click ends measurement mode (and prevents zoom)
    map.on('dblclick', (e) => {
      if (measuringRef.current.active) {
        e.preventDefault()
        // Add final point and end
        const { lng, lat } = e.lngLat
        addMeasurePoint(lat, lng)
        endMeasuring()
      }
    })

    // Reposition measure labels on map move
    map.on('move', repositionLabels)

    // Initialize mapCenter immediately when map loads (Fix 1: search viewport)
    map.once('load', () => {
      const center = map.getCenter()
      const zoom = map.getZoom()
      setMapCenter({ lat: center.lat, lon: center.lng, zoom })
    })

    map.on('load', () => {
      // Add satellite source (persists across view modes)
      addSatelliteSource(map)
      
      // Restore view mode from localStorage
      const savedViewMode = localStorage.getItem('navi-view-mode') || 'map'
      if (savedViewMode === 'satellite') {
        setSatelliteMode(map, currentThemeRef.current)
      } else if (savedViewMode === 'hybrid') {
        setHybridMode(map, currentThemeRef.current)
      }
      
      // Guard against double-mount in React strict mode
      if (!map.getSource(ROUTE_SOURCE)) {
        map.addSource(ROUTE_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      // Boundary polygon layer for selected places
      if (!map.getLayer(BOUNDARY_LAYER)) {
        addBoundaryLayer(map)
      }

      // Apply improved base label styling for readability
      applyBaseLabelStyling(map)

      // Restore overlay layers from localStorage prefs
      try {
        const raw = localStorage.getItem('navi-layer-prefs')
        if (raw) {
          const prefs = JSON.parse(raw)
          if (prefs.hillshade && hasFeature('has_hillshade')) {
            addHillshade(map, currentThemeRef.current)
            activeLayersRef.current.hillshade = true
          }
          if (prefs.traffic && hasFeature('has_traffic_overlay')) {
            addTraffic(map, currentThemeRef.current)
            activeLayersRef.current.traffic = true
          }
          if (prefs.publicLands && hasFeature('has_public_lands_layer')) {
            addPublicLands(map, currentThemeRef.current)
            activeLayersRef.current.publicLands = true
          }
          if (prefs.contours && hasFeature('has_contours')) {
            addContours(map, currentThemeRef.current)
            activeLayersRef.current.contours = true
          }
        } else if (hasFeature('has_hillshade')) {
          // Default: hillshade ON if available
          addHillshade(map, currentThemeRef.current)
          activeLayersRef.current.hillshade = true
        }
      } catch {}


      // Register updateBoundary function - called directly when boundary data arrives
      const updateBoundaryFn = (boundaryGeometry) => {
        const source = map.getSource(BOUNDARY_SOURCE)
        if (!source) return

        if (!boundaryGeometry) {
          source.setData({ type: 'FeatureCollection', features: [] })
          return
        }

        if (boundaryGeometry.type === 'Polygon' || boundaryGeometry.type === 'MultiPolygon') {
          source.setData({
            type: 'Feature',
            geometry: boundaryGeometry,
            properties: {},
          })

          // Zoom to fit boundary
          try {
            const coords = boundaryGeometry.type === 'Polygon'
              ? boundaryGeometry.coordinates[0]
              : boundaryGeometry.coordinates.flat(2)

            if (coords.length > 0) {
              let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
              for (const [lng, lat] of coords) {
                if (lng < minLng) minLng = lng
                if (lng > maxLng) maxLng = lng
                if (lat < minLat) minLat = lat
                if (lat > maxLat) maxLat = lat
              }
              // Validate bounds before fitting
              if (minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 &&
                  minLng < maxLng && minLat < maxLat) {
                map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                  padding: 50,
                  duration: 700,
                  maxZoom: 16,
                })
              } else {
                console.warn('Invalid bounds:', { minLng, maxLng, minLat, maxLat })
              }
            }
          } catch (e) {
            console.warn('fitBounds error:', e)
          }
        }
      }
      updateBoundaryRef.current = updateBoundaryFn
      useStore.getState().setUpdateBoundary(updateBoundaryFn)

      // POI/label hover affordance — cursor pointer + highlight
      const interactiveLayers = ['pois', 'places_locality', 'places_region', 'places_country', 'places_subplace']

      interactiveLayers.forEach(layerId => {
        map.on('mouseenter', layerId, (e) => {
          if (!measuringRef.current.active) {
            map.getCanvas().style.cursor = 'pointer'
            const feature = e.features?.[0]
            if (feature?.properties?.name) {
              setHoverHighlight(map, feature)
              hoveredFeatureRef.current = feature
            }
          }
        })

        map.on('mouseleave', layerId, () => {
          if (!measuringRef.current.active) {
            map.getCanvas().style.cursor = ''
            setHoverHighlight(map, null)
            hoveredFeatureRef.current = null
          }
        })
      })
    })

    mapInstance.current = map

    // ResizeObserver to handle layout settling, panel changes, window resize
    const ro = new ResizeObserver(() => {
      map.resize()
    })
    ro.observe(mapRef.current)

    return () => {
      ro.disconnect()
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      if (gpsMarkerRef.current) gpsMarkerRef.current.remove()
      // Clean up measure labels
      measureLabelsRef.current.forEach(el => el.remove())
      measureLabelsRef.current = []
      maplibregl.removeProtocol('pmtiles')
      map.remove()
    }
  }, [setSheetState])

  /** Create or update the GPS chevron/dot marker */
  function createOrUpdateGpsMarker(map, lat, lon, heading) {
    if (!gpsMarkerRef.current) {
      const el = document.createElement('div')
      if (heading != null && !isNaN(heading)) {
        el.className = 'navi-chevron'
        el.innerHTML = CHEVRON_SVG
        el.style.transform = `rotate(${heading}deg)`
      } else {
        el.className = 'navi-gps-dot'
      }
      gpsMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .addTo(map)
    } else {
      gpsMarkerRef.current.setLngLat([lon, lat])
      const el = gpsMarkerRef.current.getElement()
      if (heading != null && !isNaN(heading)) {
        if (!el.classList.contains('navi-chevron')) {
          el.className = 'navi-chevron'
          el.innerHTML = CHEVRON_SVG
        }
        el.style.transform = `rotate(${heading}deg)`
      } else {
        if (!el.classList.contains('navi-gps-dot')) {
          el.className = 'navi-gps-dot'
          el.innerHTML = ''
        }
      }
    }
  }

  // React to permission changes from LocateButton (when user grants after initial denial)
  useEffect(() => {
    const map = mapInstance.current
    if (!map || geoPermission !== 'granted') return

    // If marker already exists, watchPosition is already running — nothing to do
    if (gpsMarkerRef.current) return

    // Permission was just granted (likely from LocateButton) — create marker + start tracking
    const loc = useStore.getState().userLocation
    if (loc) {
      createOrUpdateGpsMarker(map, loc.lat, loc.lon, null)
    }

    if (!watchIdRef.current) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, heading } = pos.coords
          useStore.getState().setUserLocation({ lat: latitude, lon: longitude })
          createOrUpdateGpsMarker(map, latitude, longitude, heading)
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
      )
    }
  }, [geoPermission])

    // Swap map theme when store.theme changes
  useEffect(() => {
    const map = mapInstance.current
    if (!map || currentThemeRef.current === theme) return

    currentThemeRef.current = theme
    const center = map.getCenter()
    const zoom = map.getZoom()
    const bearing = map.getBearing()
    const pitch = map.getPitch()

    map.setStyle(buildStyle(theme), { diff: false })

    // Re-add sources/layers after style swap
    map.once('style.load', () => {
      // Guard against source already existing
      if (!map.getSource(ROUTE_SOURCE)) {
        map.addSource(ROUTE_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      // Boundary polygon layer
      if (!map.getLayer(BOUNDARY_LAYER)) {
        addBoundaryLayer(map)
      }

      // Apply improved base label styling for readability
      applyBaseLabelStyling(map)

      // Re-add active overlay layers
      if (activeLayersRef.current.hillshade) addHillshade(map, currentThemeRef.current)
      if (activeLayersRef.current.traffic) addTraffic(map, currentThemeRef.current)
      if (activeLayersRef.current.publicLands) addPublicLands(map, currentThemeRef.current)
      if (activeLayersRef.current.contours) addContours(map, currentThemeRef.current)
      if (activeLayersRef.current.contoursTest) addContoursTest(map, currentThemeRef.current)
      if (activeLayersRef.current.contoursTest10ft) addContoursTest10ft(map, currentThemeRef.current)
      if (activeLayersRef.current.usfsTrails) addUsfsTrails(map, currentThemeRef.current)
      if (activeLayersRef.current.blmTrails) addBlmTrails(map, currentThemeRef.current)

      // Re-add satellite source and restore view mode
      addSatelliteSource(map)
      const savedViewMode = localStorage.getItem('navi-view-mode') || 'map'
      if (savedViewMode === 'satellite') {
        setSatelliteMode(map, currentThemeRef.current)
      } else if (savedViewMode === 'hybrid') {
        setHybridMode(map, currentThemeRef.current)
      }

      // Clear highlights on theme change (paint values will be re-stored on next interaction)
      clearAllHighlights(map)
      originalPaintValues = {}

      // Restore view
      map.jumpTo({ center, zoom, bearing, pitch })
      // Re-render route if exists
      const currentRoute = useStore.getState().route
      if (currentRoute) updateRoute(map, currentRoute)
    })
  }, [theme])

  // Preview pin for selected place
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    // Remove old preview marker
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove()
      previewMarkerRef.current = null
    }

    if (!selectedPlace) return

    // Only fly to place if it came from search (not map-click which already centered)
    if (selectedPlace.source !== 'map_click' && selectedPlace.source !== 'basemap_label') {
      map.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 14, duration: 800 })
    }

    // Different visual feedback based on mode
    const isFeatureMode = selectedPlace.mode === 'feature'

    // Create marker element
    const el = document.createElement('div')
    if (isFeatureMode) {
      // Feature mode: subtle ring indicator
      el.className = 'navi-feature-highlight'
    } else {
      // Reticle mode: pin with center dot
      el.className = 'navi-pin-preview'
      const dot = document.createElement('div')
      dot.className = 'navi-pin-center-dot'
      el.appendChild(dot)
    }

    previewMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([selectedPlace.lon, selectedPlace.lat])
      .addTo(map)

    return () => {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove()
        previewMarkerRef.current = null
      }
    }
  }, [selectedPlace])

  // Escape key to close/deselect place card
  useEffect(() => {
    if (!selectedPlace) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        const map = mapInstance.current
        const store = useStore.getState()

        // Clear selected place and click marker
        store.clearSelectedPlace()
        store.clearClickMarker()

        // Clear boundary
        if (updateBoundaryRef.current) updateBoundaryRef.current(null)

        // Clear highlight
        if (map) setSelectedHighlight(map, null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedPlace])

  // Update route polyline when route changes
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      const handler = () => updateRoute(map, route)
      map.once('idle', handler)
      return () => map.off('idle', handler)
    }
    updateRoute(map, route)
  }, [route])

  function updateRoute(map, routeData) {
    if (!map) return

    // Remove old route layers
    const style = map.getStyle()
    if (style) {
      for (const layer of style.layers) {
        if (layer.id.startsWith(ROUTE_LAYER_PREFIX)) {
          map.removeLayer(layer.id)
        }
      }
    }

    if (!routeData || !routeData.legs) {
      if (map.getSource(ROUTE_SOURCE)) {
        map.getSource(ROUTE_SOURCE).setData({ type: 'FeatureCollection', features: [] })
      }
      return
    }

    const features = []
    for (let i = 0; i < routeData.legs.length; i++) {
      const leg = routeData.legs[i]
      if (!leg.shape) continue
      const coords = decodePolyline(leg.shape, 6)
      features.push({
        type: 'Feature',
        properties: { legIndex: i },
        geometry: { type: 'LineString', coordinates: coords },
      })
    }

    const source = map.getSource(ROUTE_SOURCE)
    if (source) {
      source.setData({ type: 'FeatureCollection', features })
    } else {
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })
    }

    // Use CSS variable for route color (read computed value)
    const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--route-line').trim()

    for (let i = 0; i < features.length; i++) {
      const layerId = `${ROUTE_LAYER_PREFIX}${i}`
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: ROUTE_SOURCE,
          filter: ['==', ['get', 'legIndex'], i],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': routeColor || '#7a9a6b',
            'line-width': 5,
            'line-opacity': 0.85,
          },
        })
      }
    }

    // Fit bounds to route
    if (features.length > 0) {
      const allCoords = features.flatMap((f) => f.geometry.coordinates)
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(allCoords[0], allCoords[0])
      )
      // Single-panel: no floating detail
      const leftPad = 420  // 360px panel + margin
      map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: leftPad, right: 60 } })
    }
  }

  // Update stop markers when stops change
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    // Remove old markers
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
    if (popupRef.current) {
      popupRef.current.remove()
      popupRef.current = null
    }

    const hasGpsOrigin = gpsOrigin && geoPermission === 'granted'
    const indexOffset = hasGpsOrigin ? 1 : 0

    stops.forEach((stop, i) => {
      const displayIndex = i + indexOffset
      const effectiveTotal = stops.length + indexOffset

      let pinClass = 'navi-pin navi-pin--intermediate'
      if (displayIndex === 0) pinClass = 'navi-pin navi-pin--origin'
      else if (displayIndex === effectiveTotal - 1 && effectiveTotal > 1) pinClass = 'navi-pin navi-pin--destination'

      const label = String.fromCharCode(65 + Math.min(displayIndex, 25))

      const el = document.createElement('div')
      el.className = pinClass
      el.textContent = label

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        // Flag so the map-level click handler doesn't fire
        pinClickedRef.current = true
        if (popupRef.current) popupRef.current.remove()
        const popup = new maplibregl.Popup({ offset: 20, closeButton: true })
          .setLngLat([stop.lon, stop.lat])
          .setHTML(
            `<div style="font-size:12px;max-width:200px">
              <strong>${stop.name}</strong>
              <br/><button id="remove-stop-${stop.id}" style="margin-top:4px;padding:2px 8px;background:var(--status-danger);border:none;border-radius:4px;color:white;cursor:pointer;font-size:11px">Remove</button>
            </div>`
          )
          .addTo(map)

        popup.getElement().querySelector(`#remove-stop-${stop.id}`)?.addEventListener('click', () => {
          useStore.getState().removeStop(stop.id)
          popup.remove()
        })
        popupRef.current = popup
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map)

      markersRef.current.push(marker)
    })

    // If stops but no route yet, fit to stops
    if (stops.length > 0 && !route) {
      if (stops.length === 1) {
        map.flyTo({ center: [stops[0].lon, stops[0].lat], zoom: 13 })
      } else {
        const bounds = stops.reduce(
          (b, s) => b.extend([s.lon, s.lat]),
          new maplibregl.LngLatBounds([stops[0].lon, stops[0].lat], [stops[0].lon, stops[0].lat])
        )
        map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 420, right: 60 } })
      }
    }
  }, [stops, route, gpsOrigin, geoPermission])


  // ESC key handler for measurement mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && measuringRef.current.active) {
        endMeasuring()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Handle location pick mode for contacts
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (pickingLocationFor) {
      map.getCanvas().style.cursor = 'crosshair'
    }
    return () => {
      if (map && !measuringRef.current.active) {
        map.getCanvas().style.cursor = ''
      }
    }
  }, [pickingLocationFor])

  // ESC key handler for location pick mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && pickingLocationFor) {
        // Cancel pick mode, reopen modal with original form data
        const map = mapInstance.current
        if (map) map.getCanvas().style.cursor = ''
        setEditingContact(pickingLocationFor)
        clearPickingLocationFor()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pickingLocationFor, setEditingContact, clearPickingLocationFor])


  // Track zoom level for indicator
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    const updateZoom = () => setZoomLevel(map.getZoom())

    // Set initial zoom
    if (map.loaded()) {
      updateZoom()
    } else {
      map.once("load", updateZoom)
    }

    // Subscribe to zoom changes
    map.on("zoom", updateZoom)

    return () => {
      map.off("zoom", updateZoom)
    }
  }, [])


  // Track map center for search viewport bias
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    const updateCenter = () => {
      const center = map.getCenter()
      const zoom = map.getZoom()
      setMapCenter({ lat: center.lat, lon: center.lng, zoom })
    }

    // Set initial center
    if (map.loaded()) {
      updateCenter()
    } else {
      map.once("load", updateCenter)
    }

    // Update on move end (not every frame)
    map.on("moveend", updateCenter)

    return () => {
      map.off("moveend", updateCenter)
    }
  }, [setMapCenter])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" {...contextMenuHandlers} />
      {/* Zoom level indicator - bottom-left corner */}
      <div
        className="absolute bottom-4 left-4 z-50 px-2 py-1 rounded-full text-xs font-mono pointer-events-none"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          color: "white",
          fontSize: "12px",
          padding: "4px 8px",
          borderRadius: "12px",
        }}
      >
        Z {zoomLevel.toFixed(1)}
      </div>

      {/* Measurement info bar */}
      {(measuring.active || measuring.points.length > 1) && (
        <div
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-lg"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            color: "white",
            fontSize: "13px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <Ruler size={16} style={{ opacity: 0.8 }} />
          <span>
            <strong>{formatDistance(measuring.totalMeters)}</strong>
            <span style={{ opacity: 0.7, marginLeft: "6px" }}>
              ({measuring.points.length} {measuring.points.length === 1 ? "point" : "points"})
            </span>
          </span>
          {measuring.active && (
            <span style={{ opacity: 0.6, fontSize: "11px" }}>
              Click to add points
            </span>
          )}
          <button
            onClick={endMeasuring}
            className="px-2 py-1 rounded text-xs font-medium"
            style={{
              background: "var(--accent)",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Done
          </button>
          <button
            onClick={clearMeasuring}
            className="p-1 rounded"
            style={{
              background: "transparent",
              color: "white",
              border: "none",
              cursor: "pointer",
              opacity: 0.7,
            }}
            title="Clear measurement"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Radial context menu */}
      <RadialMenu
        open={radialMenu.open}
        x={radialMenu.x}
        y={radialMenu.y}
        lat={radialMenu.lat}
        lon={radialMenu.lon}
        wedges={radialWedges}
        centerLabel={radialMenu.centerLabel}
        onDismiss={() => setRadialMenu((m) => ({ ...m, open: false }))}
      />
    </div>
  )
})

export default MapView
