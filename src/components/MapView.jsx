import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
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
  const activeLayersRef = useRef({ hillshade: false, traffic: false })
  // Flag to suppress map-click when a stop pin was clicked
  const pinClickedRef = useRef(false)

  const stops = useStore((s) => s.stops)
  const route = useStore((s) => s.route)
  const theme = useStore((s) => s.theme)
  const selectedPlace = useStore((s) => s.selectedPlace)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const geoPermission = useStore((s) => s.geoPermission)
  const setSheetState = useStore((s) => s.setSheetState)

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

    // GPS tracking — creates chevron or dot marker
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          if (useStore.getState().stops.length === 0) {
            map.flyTo({ center: [longitude, latitude], zoom: 12, duration: 1500 })
          }
          useStore.getState().setUserLocation({ lat: latitude, lon: longitude })
          useStore.getState().setGeoPermission('granted')
          createOrUpdateGpsMarker(map, latitude, longitude, null)
        },
        () => {
          useStore.getState().setGeoPermission('denied')
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      )

      // Watch for heading changes
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

  return <div ref={mapRef} className="w-full h-full" />
})

export default MapView
