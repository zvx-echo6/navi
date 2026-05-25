import { useRef, useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut, Footprints, Bike, Car, Shield, AlertTriangle, Zap, X, MapPin, Target } from 'lucide-react'
import ThemePicker from './ThemePicker'
import { useStore, usePanelState } from '../store'
import { hasFeature } from '../config'
import { useConfig } from '../hooks/useConfig'
import SearchBar from './SearchBar'
import ManeuverList from './ManeuverList'
import ContactList from './ContactList'
import { PlaceCard } from './PlaceCard'
import DirectionsPanel from './DirectionsPanel'
import PlaceDetail from './PlaceDetail'

const TRAVEL_MODES = [
  { id: 'auto', label: 'Drive', Icon: Car },
  { id: 'foot', label: 'Foot', Icon: Footprints },
  { id: '2w', label: '2W', Icon: Bike },
  { id: '4w', label: '4W', Icon: Car },
  { id: 'vehicle', label: '4x4', Icon: Car },
]

const BOUNDARY_MODES = [
  { id: 'strict', label: 'Strict', Icon: Shield, title: 'Avoid barriers' },
  { id: 'pragmatic', label: 'Cross', Icon: AlertTriangle, title: 'Cross with penalty' },
  { id: 'emergency', label: 'Ignore', Icon: Zap, title: 'Ignore barriers' },
]

export default function Panel({ onClearRoute }) {
  const selectedPlace = useStore((s) => s.selectedPlace)
  const clearSelectedPlace = useStore((s) => s.clearSelectedPlace)
  const routeStart = useStore((s) => s.routeStart)
  const routeEnd = useStore((s) => s.routeEnd)
  const routeMode = useStore((s) => s.routeMode)
  const boundaryMode = useStore((s) => s.boundaryMode)
  const routeResult = useStore((s) => s.routeResult)
  const routeLoading = useStore((s) => s.routeLoading)
  const setRouteMode = useStore((s) => s.setRouteMode)
  const setBoundaryMode = useStore((s) => s.setBoundaryMode)
  const pickingRouteField = useStore((s) => s.pickingRouteField)
  const setPickingRouteField = useStore((s) => s.setPickingRouteField)
  const clearRoute = useStore((s) => s.clearRoute)
  const sheetState = useStore((s) => s.sheetState)
  const setSheetState = useStore((s) => s.setSheetState)
  const activeTab = useStore((s) => s.activeTab)
  const auth = useStore((s) => s.auth)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const directionsMode = useStore((s) => s.directionsMode)
  const setDirectionsMode = useStore((s) => s.setDirectionsMode)

  const panelState = usePanelState()

  const [isMobile, setIsMobile] = useState(false)
  const sheetRef = useRef(null)
  const dragStartY = useRef(0)
  const dragStartState = useRef('half')

  const showContacts = hasFeature('has_contacts') && auth.authenticated
  const cfg = useConfig()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Auth URLs come from /api/config (config.auth.*); the literals are the
  // current home-profile values, kept as fallback for an older backend that
  // doesn't yet serve `auth`, or when FALLBACK_CONFIG is in use (offline).
  // TODO(navi): add tests when test infra lands — see extraction #2 PR-C
  const handleLogin = () => { window.location.href = cfg?.auth?.login_url ?? '/outpost.goauthentik.io/start?rd=%2F' }
  const handleLogout = () => { window.location.href = cfg?.auth?.logout_url ?? 'https://auth.echo6.co/if/flow/default-invalidation-flow/?next=https://navi.echo6.co/' }

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

  const handleClearRoute = () => {
    clearRoute()
    onClearRoute?.()
  }

  const showPreviewCard = panelState.startsWith('PREVIEW')
  const hasRoutePoints = routeStart || routeEnd
  const showRouteSection = hasRoutePoints || routeResult || routeLoading
  const showEmptyState = panelState === 'IDLE' && !hasRoutePoints

  // Show side panel place card when building route (either mode) and place is selected
  const showSidePlaceCard = (directionsMode || showRouteSection) && selectedPlace

  const routesContent = directionsMode ? (
    // Directions mode: just the directions panel, place card is shown in side panel
    <DirectionsPanel onClose={() => {
      setDirectionsMode(false)
      onClearRoute?.()
    }} />
  ) : (
    <>
      <SearchBar />

      {showPreviewCard && selectedPlace && !showRouteSection && (
        <div className="mt-3">
          <PlaceCard
            place={selectedPlace}
            variant="preview"
            expanded={true}
            onClose={clearSelectedPlace}
          />
        </div>
      )}

      {showRouteSection && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Route
            </span>
            <button
              onClick={handleClearRoute}
              className="p-1 rounded hover:bg-[var(--bg-overlay)]"
              title="Clear route"
            >
              <X size={14} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>

          <div className="flex flex-col gap-1 mb-3 text-xs">
            <div className="flex items-center gap-2">
              <MapPin size={12} style={{ color: '#22c55e' }} />
              <span className="flex-1" style={{ color: routeStart ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {routeStart?.name || 'Click pin to pick start'}
              </span>
              <button
                onClick={() => setPickingRouteField('origin')}
                className="p-1 rounded hover:bg-[var(--bg-overlay)] transition-colors"
                style={{ color: pickingRouteField === 'origin' ? 'var(--accent)' : 'var(--text-tertiary)' }}
                title="Pick start from map"
              >
                <Target size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={12} style={{ color: '#ef4444' }} />
              <span className="flex-1" style={{ color: routeEnd ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {routeEnd?.name || 'Click pin to pick destination'}
              </span>
              <button
                onClick={() => setPickingRouteField('destination')}
                className="p-1 rounded hover:bg-[var(--bg-overlay)] transition-colors"
                style={{ color: pickingRouteField === 'destination' ? 'var(--accent)' : 'var(--text-tertiary)' }}
                title="Pick destination from map"
              >
                <Target size={14} />
              </button>
            </div>
          </div>

          <div className="flex gap-1 mb-2">
            {TRAVEL_MODES.map((m) => {
              const active = routeMode === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => setRouteMode(m.id)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded transition-colors"
                  style={{
                    background: active ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                    color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                  }}
                  title={m.label}
                >
                  <m.Icon size={14} />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              )
            })}
          </div>

          {routeMode !== 'auto' && (
            <div className="flex gap-1 mb-3">
              {BOUNDARY_MODES.map((m) => {
                const active = boundaryMode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => setBoundaryMode(m.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded transition-colors"
                    style={{
                      background: active ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                      color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                    }}
                    title={m.title}
                  >
                    <m.Icon size={14} />
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          <ManeuverList />
        </div>
      )}

      {showEmptyState && (
        <div className="mt-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <p>Search or tap the map to explore</p>
        </div>
      )}
    </>
  )

  const content = (
    <>
      {showContacts && (
        <div className="navi-tab-bar mb-3">
          <button
            className={"navi-tab " + (activeTab === 'routes' ? 'navi-tab-active' : '')}
            onClick={() => setActiveTab('routes')}
          >
            Routes
          </button>
          <button
            className={"navi-tab " + (activeTab === 'contacts' ? 'navi-tab-active' : '')}
            onClick={() => setActiveTab('contacts')}
          >
            Contacts
          </button>
        </div>
      )}

      {(!showContacts || activeTab === 'routes') ? routesContent : <ContactList />}
    </>
  )

  const header = (
    <div className="flex items-center justify-between mb-3">
      <h1 className="text-md font-semibold" style={{ color: 'var(--accent)' }}>Navi</h1>
      <div className="flex items-center gap-1">
        {auth.loaded && (
          auth.authenticated ? (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              style={{ color: 'var(--text-tertiary)' }}
              title={"Logged in as " + auth.username + ". Click to log out."}
            >
              <span className="hidden sm:inline">{auth.username}</span>
              <LogOut size={14} />
            </button>
          ) : (
            <button
              onClick={handleLogin}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              style={{ color: 'var(--accent)' }}
              title="Log in"
            >
              <LogIn size={14} />
              <span>Log in</span>
            </button>
          )
        )}
        <ThemePicker />
      </div>
    </div>
  )

  // Side panel for place card during directions mode (desktop only)
  const sidePlaceCardPanel = showSidePlaceCard && !isMobile && (
    <div
      className="absolute top-0 z-10 h-full overflow-y-auto p-4 flex flex-col"
      style={{
        left: '400px',
        width: '300px',
        background: 'var(--bg-raised)',
        borderRight: '1px solid var(--border)',
        boxShadow: 'inset 4px 0 8px -4px rgba(0,0,0,0.15)',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {selectedPlace?.name || 'Place Info'}
        </span>
        <button
          onClick={clearSelectedPlace}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-overlay)] transition-colors"
          title="Close"
        >
          <X size={16} style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </div>
      {/* Use PlaceCard in compact preview mode */}
      <PlaceCard
        place={selectedPlace}
        variant="preview"
        expanded={true}
        onClose={clearSelectedPlace}
      />
    </div>
  )

  // Mobile overlay for place card during directions mode
  const mobilePlaceCardOverlay = showSidePlaceCard && isMobile && (
    <div
      className="absolute inset-0 z-20 flex flex-col rounded-t-2xl"
      style={{ background: 'var(--bg-raised)' }}
    >
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-medium truncate pr-2" style={{ color: 'var(--text-primary)' }}>
          {selectedPlace?.name || 'Place Info'}
        </span>
        <button
          onClick={clearSelectedPlace}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-overlay)] transition-colors shrink-0"
          title="Close"
        >
          <X size={16} style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <PlaceCard
          place={selectedPlace}
          variant="preview"
          expanded={true}
          onClose={clearSelectedPlace}
        />
      </div>
    </div>
  )

  if (!isMobile) {
    return (
      <>
        <div
          className="absolute top-0 left-0 z-10 h-full overflow-y-auto p-4 flex flex-col"
          style={{
            width: '400px',
            background: 'var(--bg-raised)',
            borderRight: '1px solid var(--border)',
          }}
        >
          {header}
          {content}
        </div>
        {sidePlaceCardPanel}
      </>
    )
  }

  const sheetHeights = {
    collapsed: 'h-12',
    half: 'h-[45vh]',
    full: 'h-[85vh]',
  }

  return (
    <div
      ref={sheetRef}
      className={"absolute bottom-0 left-0 right-0 z-10 rounded-t-2xl transition-all duration-200 " + sheetHeights[sheetState]}
      style={{
        background: 'var(--bg-raised)',
        borderTop: '1px solid var(--border)',
      }}
    >
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
        <div className="px-4 pb-4 overflow-y-auto overflow-x-hidden h-[calc(100%-2rem)] relative" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {header}
          {content}
          {mobilePlaceCardOverlay}
        </div>
      )}
    </div>
  )
}
