import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedTheme } from 'protomaps-themes-base'
import { useStore } from '../store'
import { decodePolyline } from '../utils/decode'

const ROUTE_SOURCE = 'route-source'
const ROUTE_LAYER_PREFIX = 'route-layer-'
const STOPS_SOURCE = 'stops-source'
const STOPS_LAYER = 'stops-layer'

const MapView = forwardRef(function MapView({ onMapClick }, ref) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])
  const popupRef = useRef(null)

  const stops = useStore((s) => s.stops)
  const route = useStore((s) => s.route)
  const setSheetState = useStore((s) => s.setSheetState)

  // Expose map methods to parent
  useImperativeHandle(ref, () => ({
    flyTo(lat, lon, zoom = 14) {
      mapInstance.current?.flyTo({ center: [lon, lat], zoom })
    },
    getMap() {
      return mapInstance.current
    },
  }))

  // Initialize map
  useEffect(() => {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    // Default center: Matt's home (Filer, ID) — updated by geolocation if permitted
    const DEFAULT_CENTER = [-114.6066, 42.5736]
    const DEFAULT_ZOOM = 10

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/dark',
        sources: {
          protomaps: {
            type: 'vector',
            url: 'pmtiles:///tiles/na.pmtiles',
            attribution:
              '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
          },
        },
        layers: layers('protomaps', namedTheme('dark'), { lang: 'en' }),
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // Request geolocation for initial view (not for routing — that's separate)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          // Only fly to user location if no stops have been added yet
          if (useStore.getState().stops.length === 0) {
            map.flyTo({ center: [longitude, latitude], zoom: 12, duration: 1500 })
          }
          useStore.getState().setUserLocation({ lat: latitude, lon: longitude })
          useStore.getState().setGeoPermission('granted')
        },
        () => {
          useStore.getState().setGeoPermission('denied')
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      )
    }

    map.on('click', () => {
      // Mobile: collapse sheet when map is tapped
      if (window.innerWidth < 768) {
        setSheetState('collapsed')
      }
    })

    // Add empty route source on load
    map.on('load', () => {
      map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    })

    mapInstance.current = map

    return () => {
      maplibregl.removeProtocol('pmtiles')
      map.remove()
    }
  }, [setSheetState])

  // Update route polyline when route changes
  useEffect(() => {
    const map = mapInstance.current
    if (!map || !map.isStyleLoaded()) {
      // Wait for style to load
      const handler = () => updateRoute(map)
      map?.on('load', handler)
      return () => map?.off('load', handler)
    }
    updateRoute(map)
  }, [route])

  function updateRoute(map) {
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

    if (!route || !route.legs) {
      if (map.getSource(ROUTE_SOURCE)) {
        map.getSource(ROUTE_SOURCE).setData({ type: 'FeatureCollection', features: [] })
      }
      return
    }

    // Build GeoJSON features from route legs
    const features = []
    const legColors = ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75']

    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i]
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

    // Add route layers (one per leg for color variation)
    for (let i = 0; i < features.length; i++) {
      const layerId = `${ROUTE_LAYER_PREFIX}${i}`
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: ROUTE_SOURCE,
          filter: ['==', ['get', 'legIndex'], i],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': legColors[i % legColors.length],
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
      map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 340, right: 60 } })
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

    stops.forEach((stop, i) => {
      let color = '#3b82f6' // blue
      if (i === 0) color = '#22c55e' // green
      else if (i === stops.length - 1 && stops.length > 1) color = '#ef4444' // red

      const label = String.fromCharCode(65 + Math.min(i, 25))

      const el = document.createElement('div')
      el.className = 'navi-marker'
      el.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%;
        background: ${color}; border: 2px solid white;
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 12px; font-weight: bold;
        cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      `
      el.textContent = label

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        if (popupRef.current) popupRef.current.remove()
        const popup = new maplibregl.Popup({ offset: 20, closeButton: true })
          .setLngLat([stop.lon, stop.lat])
          .setHTML(
            `<div style="color:#fff;font-size:12px;max-width:200px">
              <strong>${stop.name}</strong>
              <br/><button id="remove-stop-${stop.id}" style="margin-top:4px;padding:2px 8px;background:#dc2626;border:none;border-radius:4px;color:white;cursor:pointer;font-size:11px">Remove</button>
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
  }, [stops, route])

  return <div ref={mapRef} className="w-full h-full" />
})

export default MapView
