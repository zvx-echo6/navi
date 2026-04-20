import { useRef, useCallback, useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useStore } from '../store'
import SearchBar from './SearchBar'
import StopList from './StopList'
import ModeSelector from './ModeSelector'
import ManeuverList from './ManeuverList'
import { requestOptimizedRoute } from '../api'

export default function Panel({ onManeuverClick }) {
  const stops = useStore((s) => s.stops)
  const mode = useStore((s) => s.mode)
  const route = useStore((s) => s.route)
  const routeLoading = useStore((s) => s.routeLoading)
  const routeError = useStore((s) => s.routeError)
  const setStops = useStore((s) => s.setStops)
  const setRoute = useStore((s) => s.setRoute)
  const setRouteError = useStore((s) => s.setRouteError)
  const setRouteLoading = useStore((s) => s.setRouteLoading)
  const sheetState = useStore((s) => s.sheetState)
  const setSheetState = useStore((s) => s.setSheetState)
  const theme = useStore((s) => s.theme)
  const themeOverride = useStore((s) => s.themeOverride)
  const setThemeOverride = useStore((s) => s.setThemeOverride)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const geoPermission = useStore((s) => s.geoPermission)

  const [isMobile, setIsMobile] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const sheetRef = useRef(null)
  const dragStartY = useRef(0)
  const dragStartState = useRef('half')

  // Responsive detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Theme toggle
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeOverride(next)
  }

  // Optimize stops
  const hasGpsOrigin = gpsOrigin && geoPermission === 'granted'
  const effectiveCount = stops.length + (hasGpsOrigin ? 1 : 0)

  const handleOptimize = useCallback(async () => {
    if (effectiveCount < 3 || optimizing) return
    setOptimizing(true)
    try {
      const { userLocation } = useStore.getState()
      let locations = stops.map((s) => ({ lat: s.lat, lon: s.lon }))
      if (hasGpsOrigin && userLocation) {
        locations = [{ lat: userLocation.lat, lon: userLocation.lon }, ...locations]
      }
      const data = await requestOptimizedRoute(locations, mode)
      if (data.trip) {
        // If GPS origin was prepended, skip it from the result waypoints
        const wpOrder = hasGpsOrigin && userLocation
          ? (data.trip.locations || []).slice(1)
          : data.trip.locations
        if (wpOrder && wpOrder.length === stops.length) {
          const reordered = wpOrder.map((wp) => {
            let closest = stops[0]
            let minDist = Infinity
            for (const s of stops) {
              const d = Math.abs(s.lat - wp.lat) + Math.abs(s.lon - wp.lon)
              if (d < minDist) {
                minDist = d
                closest = s
              }
            }
            return closest
          })
          const seen = new Set()
          const unique = reordered.filter((s) => {
            if (seen.has(s.id)) return false
            seen.add(s.id)
            return true
          })
          if (unique.length === stops.length) {
            setStops(unique)
          }
        }
        setRoute(data.trip)
      }
    } catch (e) {
      setRouteError(e.message)
    } finally {
      setOptimizing(false)
    }
  }, [stops, mode, optimizing, effectiveCount, hasGpsOrigin, setStops, setRoute, setRouteError])

  // Mobile sheet drag handling
  const handleTouchStart = useCallback((e) => {
    dragStartY.current = e.touches[0].clientY
    dragStartState.current = sheetState
  }, [sheetState])

  const handleTouchEnd = useCallback((e) => {
    const deltaY = e.changedTouches[0].clientY - dragStartY.current
    if (Math.abs(deltaY) < 30) return
    if (deltaY < 0) {
      if (dragStartState.current === 'collapsed') setSheetState('half')
      else if (dragStartState.current === 'half') setSheetState('full')
    } else {
      if (dragStartState.current === 'full') setSheetState('half')
      else if (dragStartState.current === 'half') setSheetState('collapsed')
    }
  }, [setSheetState])

  const showOptimize = effectiveCount >= 3

  const content = (
    <>
      <SearchBar />

      <div className="mt-3">
        <StopList />
      </div>

      {stops.length >= 1 && (
        <div className="mt-3 flex flex-col gap-2">
          <ModeSelector />
          {showOptimize && (
            <button
              onClick={handleOptimize}
              disabled={optimizing || routeLoading}
              className="navi-btn-secondary w-full"
            >
              {optimizing ? 'Optimizing...' : 'Optimize stop order'}
            </button>
          )}
        </div>
      )}

      {(route || routeLoading || routeError) && (
        <div className="mt-3">
          <ManeuverList onManeuverClick={onManeuverClick} />
        </div>
      )}

      {stops.length === 0 && !route && (
        <div className="mt-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <p>Search and add stops to build your route</p>
        </div>
      )}
    </>
  )

  const header = (
    <div className="flex items-center justify-between mb-3">
      <h1 className="text-md font-semibold" style={{ color: 'var(--accent)' }}>Navi</h1>
      <button
        onClick={toggleTheme}
        className="p-1.5 rounded"
        style={{ color: 'var(--text-secondary)' }}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  )

  // Desktop: side panel
  if (!isMobile) {
    return (
      <div
        className="absolute top-0 left-0 z-10 w-80 h-full overflow-y-auto p-4 flex flex-col"
        style={{
          background: 'var(--bg-raised)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {header}
        {content}
      </div>
    )
  }

  // Mobile: bottom sheet
  const sheetHeights = {
    collapsed: 'h-12',
    half: 'h-[45vh]',
    full: 'h-[85vh]',
  }

  return (
    <div
      ref={sheetRef}
      className={`absolute bottom-0 left-0 right-0 z-10 rounded-t-2xl transition-all duration-200 ${sheetHeights[sheetState]}`}
      style={{
        background: 'var(--bg-raised)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex justify-center py-2 cursor-grab"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (sheetState === 'collapsed') setSheetState('half')
          else if (sheetState === 'half') setSheetState('full')
          else setSheetState('half')
        }}
      >
        <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
      </div>

      {sheetState !== 'collapsed' && (
        <div className="px-4 pb-4 overflow-y-auto h-[calc(100%-2rem)]">
          {header}
          {content}
        </div>
      )}
    </div>
  )
}
