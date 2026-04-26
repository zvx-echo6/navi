import { useEffect, useRef, useCallback } from 'react'
import { useStore } from './store'
import { useTheme } from './hooks/useTheme'
import { requestRoute } from './api'
import { decodePolyline } from './utils/decode'
import MapView from './components/MapView'
import Panel from './components/Panel'

import ContactModal from './components/ContactModal'
import LayerControl from './components/LayerControl'
import LocateButton from './components/LocateButton'

export default function App() {
  const mapViewRef = useRef(null)
  const routeDebounceRef = useRef(null)

  // Initialize theme system
  useTheme()

  const stops = useStore((s) => s.stops)
  const mode = useStore((s) => s.mode)
  const route = useStore((s) => s.route)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const geoPermission = useStore((s) => s.geoPermission)
  const setRoute = useStore((s) => s.setRoute)
  const setRouteLoading = useStore((s) => s.setRouteLoading)
  const setRouteError = useStore((s) => s.setRouteError)
  const clearRoute = useStore((s) => s.clearRoute)

  // Fetch route when stops, mode, gpsOrigin, or geoPermission change (debounced 500ms)
  useEffect(() => {
    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current)

    routeDebounceRef.current = setTimeout(async () => {
      const { userLocation } = useStore.getState()

      let effective = stops.map((s) => ({ lat: s.lat, lon: s.lon }))
      if (gpsOrigin && geoPermission === 'granted' && userLocation) {
        effective = [{ lat: userLocation.lat, lon: userLocation.lon }, ...effective]
      }

      if (effective.length < 2) {
        clearRoute()
        return
      }

      setRouteLoading(true)

      try {
        const data = await requestRoute(effective, mode)
        if (data.trip) {
          setRoute(data.trip)
        } else {
          setRouteError('No route returned')
        }
      } catch (e) {
        setRouteError(e.message || 'Route request failed')
      } finally {
        setRouteLoading(false)
      }
    }, 500)

    return () => {
      if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current)
    }
  }, [stops, mode, gpsOrigin, geoPermission, clearRoute, setRoute, setRouteLoading, setRouteError])

  // Handle maneuver click
  const handleManeuverClick = useCallback(
    (maneuver) => {
      if (!route || !route.legs) return

      const legIdx = maneuver._legIndex || 0
      const leg = route.legs[legIdx]
      if (!leg || !leg.shape) return

      const coords = decodePolyline(leg.shape, 6)
      const idx = maneuver.begin_shape_index
      if (idx >= 0 && idx < coords.length) {
        const [lng, lat] = coords[idx]
        mapViewRef.current?.flyTo(lat, lng, 15)
      }
    },
    [route]
  )

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <MapView ref={mapViewRef} />
      <Panel onManeuverClick={handleManeuverClick} />
      
      <ContactModal />
      <LayerControl mapRef={mapViewRef} />
      <LocateButton mapRef={mapViewRef} />
    </div>
  )
}
