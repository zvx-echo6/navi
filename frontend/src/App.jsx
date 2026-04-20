import { useEffect, useRef, useCallback } from 'react'
import { useStore } from './store'
import { requestRoute } from './api'
import { decodePolyline } from './utils/decode'
import MapView from './components/MapView'
import Panel from './components/Panel'

export default function App() {
  const mapViewRef = useRef(null)
  const routeDebounceRef = useRef(null)

  const stops = useStore((s) => s.stops)
  const mode = useStore((s) => s.mode)
  const route = useStore((s) => s.route)
  const setRoute = useStore((s) => s.setRoute)
  const setRouteLoading = useStore((s) => s.setRouteLoading)
  const setRouteError = useStore((s) => s.setRouteError)
  const clearRoute = useStore((s) => s.clearRoute)
  const setUserLocation = useStore((s) => s.setUserLocation)
  const setGeoPermission = useStore((s) => s.setGeoPermission)

  // Request geolocation on first route action (2+ stops)
  const requestGeo = useCallback(() => {
    const { geoPermission } = useStore.getState()
    if (geoPermission !== 'prompt') return
    if (!navigator.geolocation) {
      setGeoPermission('denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setGeoPermission('granted')
      },
      () => setGeoPermission('denied'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [setUserLocation, setGeoPermission])

  // Fetch route when stops or mode change (debounced 500ms)
  useEffect(() => {
    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current)

    if (stops.length < 2) {
      clearRoute()
      return
    }

    routeDebounceRef.current = setTimeout(async () => {
      // Try to get geolocation for potential use
      requestGeo()

      const locations = stops.map((s) => ({ lat: s.lat, lon: s.lon }))
      setRouteLoading(true)

      try {
        const data = await requestRoute(locations, mode)
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
  }, [stops, mode, clearRoute, setRoute, setRouteLoading, setRouteError, requestGeo])

  // Handle maneuver click — fly to that point on the map
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
    <div className="relative w-screen h-screen overflow-hidden">
      <MapView ref={mapViewRef} />
      <Panel onManeuverClick={handleManeuverClick} />
    </div>
  )
}
