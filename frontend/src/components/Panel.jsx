import { useRef, useCallback, useEffect, useState } from 'react'
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

  // Optimize stops
  const handleOptimize = useCallback(async () => {
    if (stops.length < 3 || optimizing) return
    setOptimizing(true)
    try {
      const locations = stops.map((s) => ({ lat: s.lat, lon: s.lon }))
      const data = await requestOptimizedRoute(locations, mode)
      if (data.trip) {
        // Reorder stops based on optimized waypoint order
        const wpOrder = data.trip.locations
        if (wpOrder && wpOrder.length === stops.length) {
          // Match optimized locations back to original stops by proximity
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
          // Deduplicate (in case of matching issues)
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
  }, [stops, mode, optimizing, setStops, setRoute, setRouteError])

  // Mobile sheet drag handling
  const handleTouchStart = useCallback((e) => {
    dragStartY.current = e.touches[0].clientY
    dragStartState.current = sheetState
  }, [sheetState])

  const handleTouchEnd = useCallback((e) => {
    const deltaY = e.changedTouches[0].clientY - dragStartY.current
    if (Math.abs(deltaY) < 30) return

    if (deltaY < 0) {
      // Swipe up
      if (dragStartState.current === 'collapsed') setSheetState('half')
      else if (dragStartState.current === 'half') setSheetState('full')
    } else {
      // Swipe down
      if (dragStartState.current === 'full') setSheetState('half')
      else if (dragStartState.current === 'half') setSheetState('collapsed')
    }
  }, [setSheetState])

  const showOptimize = stops.length >= 3

  const content = (
    <>
      <SearchBar />

      {/* Stop list */}
      <div className="mt-3">
        <StopList />
      </div>

      {/* Mode selector + optimize */}
      {stops.length >= 1 && (
        <div className="mt-3 flex flex-col gap-2">
          <ModeSelector />
          {showOptimize && (
            <button
              onClick={handleOptimize}
              disabled={optimizing || routeLoading}
              className="w-full py-1.5 px-3 text-xs font-medium bg-yellow-700 hover:bg-yellow-600 text-white rounded disabled:opacity-50 transition-colors"
            >
              {optimizing ? 'Optimizing...' : 'Optimize stop order'}
            </button>
          )}
        </div>
      )}

      {/* Maneuver list */}
      {(route || routeLoading || routeError) && (
        <div className="mt-3">
          <ManeuverList onManeuverClick={onManeuverClick} />
        </div>
      )}

      {/* TODO: Recents / saved places placeholder */}
      {stops.length === 0 && !route && (
        <div className="mt-6 text-center text-gray-600 text-xs">
          {/* TODO: Wire recents + favorites in a later phase */}
          <p>Recent places will appear here</p>
        </div>
      )}
    </>
  )

  // Desktop: side panel
  if (!isMobile) {
    return (
      <div className="absolute top-0 left-0 z-10 w-80 h-full bg-gray-900/95 backdrop-blur-sm border-r border-gray-700 overflow-y-auto p-4 flex flex-col">
        <h1 className="text-lg font-semibold text-cyan-400 mb-3">Navi</h1>
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
      className={`absolute bottom-0 left-0 right-0 z-10 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 rounded-t-2xl transition-all duration-300 ${sheetHeights[sheetState]}`}
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
        <div className="w-10 h-1 bg-gray-600 rounded-full" />
      </div>

      {sheetState !== 'collapsed' && (
        <div className="px-4 pb-4 overflow-y-auto h-[calc(100%-2rem)]">
          {content}
        </div>
      )}
    </div>
  )
}
