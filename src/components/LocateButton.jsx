import { Locate } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'

export default function LocateButton({ mapRef }) {
  const handleClick = () => {
    const { userLocation } = useStore.getState()

    // If we have a cached location, fly immediately for instant feedback
    if (userLocation) {
      mapRef.current?.flyTo(userLocation.lat, userLocation.lon, 14)
    }

    // Always request fresh position — never trust cached permission state.
    // iOS Safari can "forget" a silent mount-time denial between requests,
    // and a user-gesture-triggered call is more likely to prompt.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        useStore.getState().setUserLocation(loc)
        useStore.getState().setGeoPermission('granted')
        // Fly to fresh position if we didn't have a cached one
        if (!userLocation) {
          mapRef.current?.flyTo(loc.lat, loc.lon, 14)
        }
      },
      (err) => {
        if (err.code === 1) {
          // PERMISSION_DENIED — user explicitly denied
          useStore.getState().setGeoPermission('denied')
          toast('Location access denied.\nEnable in browser settings.', { icon: '\u{1F4CD}' })
        } else if (err.code === 3 && !userLocation) {
          // TIMEOUT — only toast if we have no cached location
          toast('Location timed out. Try again.', { icon: '\u23F1\uFE0F' })
        }
        // POSITION_UNAVAILABLE (code 2): silent, likely temporary
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  if (!navigator.geolocation) return null

  return (
    <button
      className="locate-btn"
      onClick={handleClick}
      title="My location"
      aria-label="Center map on my location"
    >
      <Locate size={18} />
    </button>
  )
}
