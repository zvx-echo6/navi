import { useEffect, useRef, useCallback } from 'react'
import { useStore } from './store'
import { useTheme } from './hooks/useTheme'
import { fetchAuthState } from './api'
import MapView from './components/MapView'
import Panel from './components/Panel'

import ContactModal from './components/ContactModal'
import LayerControl from './components/LayerControl'
import LocateButton from './components/LocateButton'

export default function App() {
  const mapViewRef = useRef(null)

  // Initialize theme system
  useTheme()

  const setAuth = useStore((s) => s.setAuth)

  // Initialize auth state on app load (single fetch, no polling)
  useEffect(() => {
    fetchAuthState().then(setAuth)
  }, [setAuth])

  // Handle clear route from panel
  const handleClearRoute = useCallback(() => {
    mapViewRef.current?.clearRoute?.()
  }, [])

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <MapView ref={mapViewRef} />
      <Panel onClearRoute={handleClearRoute} />

      <ContactModal />

      {/* Bottom-right map controls */}
      <div className="map-controls-br">
        <LocateButton mapRef={mapViewRef} />
        <LayerControl mapRef={mapViewRef} />
      </div>
    </div>
  )
}
