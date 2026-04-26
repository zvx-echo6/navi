import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedTheme } from 'protomaps-themes-base'
import { useStore } from '../store'
import { decodePolyline } from '../utils/decode'
import { fetchReverse } from '../api'
import { getConfig, hasFeature } from '../config'

const ROUTE_SOURCE = 'route-source'
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

/** Build a full MapLibre style object for the given theme */
function buildStyle(themeName) {
  const config = getConfig()
  const tileUrl = config?.tileset?.url || '/tiles/na.pmtiles'
  const attribution = config?.tileset?.attribution || 'Protomaps \u00a9 OSM'

  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${themeName}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tileUrl}`,
        attribution,
      },
    },
    layers: layers('protomaps', namedTheme(themeName), { lang: 'en' }),
  }
}

/** SVG for ATAK-style chevron pointing up (will be rotated via CSS) */
const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1 L14 13 L8 10 L2 13 Z" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`

/** Add hillshade raster-dem source + layer to the map */
function addHillshade(map) {
  if (!map || map.getSource(HILLSHADE_SOURCE)) return
  const config = getConfig()
  const hs = config?.tileset_hillshade
  if (!hs?.url) return

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
      'hillshade-exaggeration': 0.5,
      'hillshade-illumination-direction': 315,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
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
function addTraffic(map) {
  if (!map || map.getSource(TRAFFIC_SOURCE)) return
  const config = getConfig()
  const tr = config?.traffic
  if (!tr?.proxy_url) return

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
      'raster-opacity': 0.6,
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
function addPublicLands(map) {
  if (!map || map.getSource(PUBLIC_LANDS_SOURCE)) return

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

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const opacityMod = isDark ? 0.7 : 1.0

  // Fill layer — data-driven color by agency + designation
  map.addLayer({
    id: PUBLIC_LANDS_FILL,
    type: 'fill',
    source: PUBLIC_LANDS_SOURCE,
    'source-layer': 'public_lands',
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'designation'], 'WA'], '#7c6b2f',
        ['==', ['get', 'designation'], 'WSA'], '#7c6b2f',
        ['==', ['get', 'agency'], 'NPS'], '#3d6b1f',
        ['==', ['get', 'agency'], 'USFS'], '#5a7c2f',
        ['==', ['get', 'agency'], 'BLM'], '#c4a672',
        ['==', ['get', 'agency'], 'FWS'], '#4a7a5a',
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR'],
          ['==', ['get', 'agency'], 'SDC'],
          ['==', ['get', 'agency'], 'SLB']
        ], '#5a8c7c',
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], '#8ca694',
        '#a0a0a0'
      ],
      'fill-opacity': [
        'case',
        ['==', ['get', 'designation'], 'WA'], 0.30 * opacityMod,
        ['==', ['get', 'designation'], 'WSA'], 0.30 * opacityMod,
        ['==', ['get', 'agency'], 'NPS'], 0.30 * opacityMod,
        ['==', ['get', 'agency'], 'USFS'], 0.25 * opacityMod,
        ['==', ['get', 'agency'], 'BLM'], 0.20 * opacityMod,
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR']
        ], 0.25 * opacityMod,
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], 0.20 * opacityMod,
        0.15 * opacityMod
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
        ['==', ['get', 'designation'], 'WA'], '#5a4d20',
        ['==', ['get', 'designation'], 'WSA'], '#5a4d20',
        ['==', ['get', 'agency'], 'NPS'], '#2a4a15',
        ['==', ['get', 'agency'], 'USFS'], '#3d5520',
        ['==', ['get', 'agency'], 'BLM'], '#8a7343',
        ['==', ['get', 'agency'], 'FWS'], '#2d5a3a',
        ['any',
          ['==', ['get', 'manager_type'], 'STAT'],
          ['==', ['get', 'agency'], 'SPR']
        ], '#3d6055',
        ['any',
          ['==', ['get', 'manager_type'], 'LOC'],
          ['==', ['get', 'manager_type'], 'DIST']
        ], '#5c6e66',
        '#707070'
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'agency'], 'NPS'], 0.7,
        ['==', ['get', 'agency'], 'USFS'], 0.6,
        ['==', ['get', 'agency'], 'BLM'], 0.5,
        0.5
      ],
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.3,
        8, 0.8,
        12, 1.2
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
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 13],
      'text-font': ['Noto Sans Regular'],
      'symbol-placement': 'point',
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': isDark ? '#c0c8b8' : '#3a4a30',
      'text-halo-color': isDark ? '#1a1a1a' : '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': 0.85,
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
function addContours(map) {
  if (!map || map.getSource(CONTOUR_SOURCE)) return

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

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const opMod = isDark ? 0.8 : 1.0

  // Minor contours (40ft) — visible z11+
  map.addLayer({
    id: CONTOUR_MINOR,
    type: 'line',
    source: CONTOUR_SOURCE,
    'source-layer': 'contours',
    minzoom: 11,
    filter: ['==', ['get', 'tier'], 'minor'],
    paint: {
      'line-color': '#8b6f47',
      'line-opacity': 0.4 * opMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 1.0],
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
      'line-color': '#8b6f47',
      'line-opacity': 0.7 * opMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 1.2],
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
      'line-color': '#6b4f2a',
      'line-opacity': 0.9 * opMod,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 14, 1.8],
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
      'text-size': 10,
      'text-font': ['Noto Sans Regular'],
      'symbol-placement': 'line',
      'text-anchor': 'center',
      'symbol-spacing': 400,
      'text-max-angle': 30,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': isDark ? '#c0b898' : '#5a4020',
      'text-halo-color': isDark ? '#1a1a1a' : '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': 0.85,
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
function addContoursTest(map) {
  if (!map || map.getSource(CONTOUR_TEST_SOURCE)) return

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

  const isDark = document.documentElement.getAttribute("data-theme") === "dark"
  const opMod = isDark ? 0.8 : 1.0

  // Minor contours (40ft) — blue scheme
  map.addLayer({
    id: CONTOUR_TEST_MINOR,
    type: "line",
    source: CONTOUR_TEST_SOURCE,
    "source-layer": "contours",
    minzoom: 11,
    filter: ["==", ["get", "tier"], "minor"],
    paint: {
      "line-color": "#4a7c9b",
      "line-opacity": 0.4 * opMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 14, 1.0],
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
      "line-color": "#4a7c9b",
      "line-opacity": 0.7 * opMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 1.2],
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
      "line-color": "#2a5a7c",
      "line-opacity": 0.9 * opMod,
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 14, 1.8],
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
      "text-size": 10,
      "text-font": ["Noto Sans Regular"],
      "symbol-placement": "line",
      "text-anchor": "center",
      "symbol-spacing": 400,
      "text-max-angle": 30,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": isDark ? "#98b8d0" : "#205080",
      "text-halo-color": isDark ? "#1a1a1a" : "#ffffff",
      "text-halo-width": 1.5,
      "text-opacity": 0.85,
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
  const activeLayersRef = useRef({ hillshade: false, traffic: false, contours: false, contoursTest: false })
  // Flag to suppress map-click when a stop pin was clicked
  const pinClickedRef = useRef(false)

  const stops = useStore((s) => s.stops)
  const route = useStore((s) => s.route)
  const theme = useStore((s) => s.theme)
  const selectedPlace = useStore((s) => s.selectedPlace)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const geoPermission = useStore((s) => s.geoPermission)
  const setSheetState = useStore((s) => s.setSheetState)

  // Zoom level indicator state
  const [zoomLevel, setZoomLevel] = useState(10)

  // Expose map methods to parent
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
      addHillshade(map)
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
      addTraffic(map)
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
      addPublicLands(map)
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
      addContours(map)
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
      addContoursTest(map)
      activeLayersRef.current.contoursTest = true
    },
    removeContoursTestLayer() {
      const map = mapInstance.current
      if (!map) return
      removeContoursTest(map)
      activeLayersRef.current.contoursTest = false
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

    // Map click — drop pin and reverse geocode
    map.on('click', (e) => {
      // If a stop pin was just clicked, skip the pin-drop
      if (pinClickedRef.current) {
        pinClickedRef.current = false
        return
      }

      if (window.innerWidth < 768) setSheetState('collapsed')

      const { lng, lat } = e.lngLat

      // Immediately set a "Dropped pin" placeholder so PlaceDetail opens with coords
      useStore.getState().setSelectedPlace({
        lat,
        lon: lng,
        name: 'Dropped pin',
        address: null,
        type: null,
        source: 'map_click',
        matchCode: null,
        raw: {},
      })

      // Reverse geocode in background — update place when result arrives
      fetchReverse(lat, lng).then((place) => {
        if (!place) return
        // Only update if the selected place is still this pin (user hasn't clicked elsewhere)
        const current = useStore.getState().selectedPlace
        if (current && Math.abs(current.lat - lat) < 0.00001 && Math.abs(current.lon - lng) < 0.00001) {
          useStore.getState().setSelectedPlace({
            ...place,
            lat,
            lon: lng,
          })
        }
      })
    })

    map.on('load', () => {
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      // Initialize zoom indicator and subscribe to zoom changes
      setZoomLevel(map.getZoom())
      map.on("zoom", () => setZoomLevel(map.getZoom()))

      // Restore overlay layers from localStorage prefs
      try {
        const raw = localStorage.getItem('navi-layer-prefs')
        if (raw) {
          const prefs = JSON.parse(raw)
          if (prefs.hillshade && hasFeature('has_hillshade')) {
            addHillshade(map)
            activeLayersRef.current.hillshade = true
          }
          if (prefs.traffic && hasFeature('has_traffic_overlay')) {
            addTraffic(map)
            activeLayersRef.current.traffic = true
          }
          if (prefs.publicLands && hasFeature('has_public_lands_layer')) {
            addPublicLands(map)
            activeLayersRef.current.publicLands = true
          }
          if (prefs.contours && hasFeature('has_contours')) {
            addContours(map)
            activeLayersRef.current.contours = true
          }
        } else if (hasFeature('has_hillshade')) {
          // Default: hillshade ON if available
          addHillshade(map)
          activeLayersRef.current.hillshade = true
        }
      } catch {}
    })

    mapInstance.current = map

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      if (gpsMarkerRef.current) gpsMarkerRef.current.remove()
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
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Re-add active overlay layers
      if (activeLayersRef.current.hillshade) addHillshade(map)
      if (activeLayersRef.current.traffic) addTraffic(map)
      if (activeLayersRef.current.publicLands) addPublicLands(map)
      if (activeLayersRef.current.contours) addContours(map)

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
    if (selectedPlace.source !== 'map_click') {
      map.flyTo({ center: [selectedPlace.lon, selectedPlace.lat], zoom: 14, duration: 800 })
    }

    // Create preview marker
    const el = document.createElement('div')
    el.className = 'navi-pin-preview'
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

  // Update route polyline when route changes
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (!map.isStyleLoaded()) {
      const handler = () => updateRoute(map, route)
      map.once('load', handler)
      return () => map.off('load', handler)
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
      const hasDetail = useStore.getState().selectedPlace != null
      const leftPad = hasDetail ? 700 : 340
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
        map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 340, right: 60 } })
      }
    }
  }, [stops, route, gpsOrigin, geoPermission])


  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />
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
    </div>
  )
})

export default MapView
