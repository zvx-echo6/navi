import { create } from 'zustand'
import { requestOffroute, requestOptimizedRoute } from './api'

export const useStore = create((set, get) => ({
  // ── Search state ──
  query: '',
  results: [],
  searchLoading: false,
  abortController: null,

  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSearchLoading: (loading) => set({ searchLoading: loading }),
  setAbortController: (ctrl) => set({ abortController: ctrl }),

  // ── Geolocation ──
  userLocation: null, // { lat, lon }
  geoPermission: 'prompt', // 'prompt' | 'granted' | 'denied'

  setUserLocation: (loc) => set({ userLocation: loc }),
  setGeoPermission: (p) => set({ geoPermission: p }),

  // ── Map viewport (for search bias) ──
  mapCenter: null, // { lat, lon, zoom }
  setMapCenter: (center) => set({ mapCenter: center }),

  // ── Unified Route State ──
  // Single routing system - all routes go through /api/offroute
  routeStart: null, // { lat, lon, name }
  routeEnd: null, // { lat, lon, name }
  routeMode: "auto", // foot | mtb | atv | vehicle
  boundaryMode: "strict", // strict | pragmatic | emergency
  routeResult: null, // Response from /api/offroute
  routeLoading: false,
  routeError: null,

  // Map display callback - set by MapView
  _updateRouteDisplay: null,
  _clearRouteDisplay: null,
  setRouteDisplayCallbacks: (update, clear) => set({ _updateRouteDisplay: update, _clearRouteDisplay: clear }),

  setRouteStart: (place) => set({ routeStart: place, routeResult: null, routeError: null }),
  setRouteEnd: (place) => set({ routeEnd: place }),
  setRouteResult: (result) => set({ routeResult: result, routeError: null }),
  setRouteLoading: (loading) => set({ routeLoading: loading }),
  setRouteError: (err) => set({ routeError: err, routeResult: null }),

  // Mode/boundary setters that trigger recalculation
  setRouteMode: (mode) => {
    set({ routeMode: mode })
    get().computeRoute()
  },
  setBoundaryMode: (mode) => {
    set({ boundaryMode: mode })
    get().computeRoute()
  },

  clearRoute: () => {
    const { _clearRouteDisplay } = get()
    if (_clearRouteDisplay) _clearRouteDisplay()
    set({
      routeStart: null,
      routeEnd: null,
      routeResult: null,
      routeError: null,
      stops: [],
      route: null
    })
  },

  // ── UNIFIED ROUTING TRIGGER ──
  // This is the SINGLE routing function for everything
  computeRoute: async () => {
    const { routeStart, routeEnd, routeMode, boundaryMode, _updateRouteDisplay } = get()
    console.log('[TRACE-ROUTE] computeRoute called with:', {
      startLat: routeStart?.lat, startLon: routeStart?.lon, startName: routeStart?.name,
      endLat: routeEnd?.lat, endLon: routeEnd?.lon, endName: routeEnd?.name
    })

    // Need both endpoints to route
    if (!routeStart || !routeEnd) return

    set({ routeLoading: true, routeError: null })

    try {
      const data = await requestOffroute(routeStart, routeEnd, routeMode, boundaryMode)

      if (data.status === "ok" && data.route) {
        set({ routeResult: data, routeError: null })
        if (_updateRouteDisplay) _updateRouteDisplay(data.route)
      } else {
        set({ routeError: data.message || data.error || "No route found", routeResult: null })
      }
    } catch (e) {
      set({ routeError: e.message, routeResult: null })
    } finally {
      set({ routeLoading: false })
    }
  },

  // ── Stop list (master compatibility) ──
  stops: [],
  gpsOrigin: true, // whether GPS should be used as origin when available
  pendingDestination: null, // place waiting for a starting point (GPS-denied Directions flow)
  route: null, // Legacy Valhalla response (for 3+ stop optimization)

  addStop: (stop) => {
    const { stops, routeMode, _updateRouteDisplay } = get()
    if (stops.length >= 10) return false
    const newStops = [...stops, { ...stop, id: crypto.randomUUID() }]
    set({ stops: newStops })

    // Route logic depends on stop count
    if (newStops.length === 1) {
      // Single stop = origin, waiting for second
      const origin = newStops[0]
      set({ routeStart: { lat: origin.lat, lon: origin.lon, name: origin.name } })
    } else if (newStops.length === 2) {
      // Two stops = use offroute (handles on-road and wilderness)
      const origin = newStops[0]
      const dest = newStops[1]
      set({
        routeStart: { lat: origin.lat, lon: origin.lon, name: origin.name },
        routeEnd: { lat: dest.lat, lon: dest.lon, name: dest.name }
      })
      get().computeRoute()
    } else {
      // 3+ stops = use Valhalla multi-stop optimization
      set({ routeLoading: true, routeError: null })
      const locations = newStops.map((s) => ({ lat: s.lat, lon: s.lon }))
      const costing = routeMode === "auto" ? "auto" : routeMode === "foot" ? "pedestrian" : routeMode === "mtb" ? "bicycle" : "auto"
      requestOptimizedRoute(locations, costing)
        .then((data) => {
          if (data.trip) {
            set({ route: data.trip, routeError: null })
            // Update display via legacy route handler if available
            if (_updateRouteDisplay && data.trip) {
              // Multi-stop uses legacy route format, need to convert or use separate handler
            }
          }
        })
        .catch((e) => set({ routeError: e.message }))
        .finally(() => set({ routeLoading: false }))
    }

    return true
  },

  removeStop: (id) => {
    const { stops } = get()
    const newStops = stops.filter((s) => s.id !== id)
    set({ stops: newStops })
    if (newStops.length === 0) {
      get().clearRoute()
    } else if (newStops.length === 1) {
      // Back to single stop
      const origin = newStops[0]
      set({
        routeStart: { lat: origin.lat, lon: origin.lon, name: origin.name },
        routeEnd: null,
        routeResult: null
      })
    }
  },

  reorderStops: (newStops) => set({ stops: newStops }),

  clearStops: () => {
    const { _clearRouteDisplay } = get()
    if (_clearRouteDisplay) _clearRouteDisplay()
    set({ stops: [], routeStart: null, routeEnd: null, routeResult: null, routeError: null })
  },

  setStops: (stops) => set({ stops }),

  setGpsOrigin: (val) => set({ gpsOrigin: val }),
  setPendingDestination: (place) => set({ pendingDestination: place }),
  clearPendingDestination: () => set({ pendingDestination: null }),

  // Master startDirections - enters directions mode with destination pre-filled
  startDirections: (place) => {
    console.log('[TRACE-STORE] startDirections received place:', { lat: place?.lat, lon: place?.lon, name: place?.name })
    const { geoPermission, userLocation, clearRoute } = get()
    clearRoute()

    // Set destination from the clicked place
    const destination = {
      lat: place.lat,
      lon: place.lon,
      name: place.name,
      source: place.source,
      matchCode: place.matchCode,
    }

    // Set origin from GPS if available
    let origin = null
    if (geoPermission === 'granted' && userLocation) {
      origin = {
        lat: userLocation.lat,
        lon: userLocation.lon,
        name: 'Your location',
        source: 'gps',
      }
    }

    set({
      routeEnd: destination,
      routeStart: origin,
      directionsMode: true,
      activeDirectionsField: origin ? null : 'origin', // Focus origin if empty
      selectedPlace: null,
    })
  },

  // Legacy route setter (for 3+ stop Valhalla optimization)
  setRoute: (route) => set({ route, routeError: null }),
  setRouteError: (err) => set({ routeError: err, route: null }),

  // ── Place detail ──
  selectedPlace: null, // { lat, lon, name, address, type, source, matchCode, raw, mode?, featureId?, featureLayer?, wikidata? }
  clickMarker: null, // { lat, lon, circleRadiusPx } — visual marker for two-click selection

  setSelectedPlace: (place) => set({ selectedPlace: place }),

  // Boundary rendering function - set by MapView, called by PlaceCard
  updateBoundary: null,
  setUpdateBoundary: (fn) => set({ updateBoundary: fn }),
  clearSelectedPlace: () => set({ selectedPlace: null, clickMarker: null }),
  setClickMarker: (marker) => set({ clickMarker: marker }),
  clearClickMarker: () => set({ clickMarker: null }),

  // ── UI state ──
  sheetState: 'half', // 'collapsed' | 'half' | 'full'
  panelOpen: true,
  autocompleteOpen: false,
  directionsMode: false, // true when directions panel is active
  activeDirectionsField: null, // 'origin' | 'destination' | 'stop-N' | null (for input focus styling)
  pickingRouteField: null, // 'origin' | 'destination' | null (explicit pick-from-map mode)
  theme: 'dark', // 'dark' | 'light' (resolved value — what's actually applied)
  themeOverride: null, // null | 'dark' | 'light' (manual override, persisted)
  viewMode: (typeof localStorage !== 'undefined' && localStorage.getItem('navi-view-mode')) || 'map', // 'map' | 'satellite' | 'hybrid'

  setSheetState: (s) => set({ sheetState: s }),
  setViewMode: (mode) => {
    set({ viewMode: mode })
    localStorage.setItem('navi-view-mode', mode)
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
  setAutocompleteOpen: (open) => set({ autocompleteOpen: open }),
  setDirectionsMode: (mode) => set({ directionsMode: mode, activeDirectionsField: mode ? 'origin' : null }),
  setActiveDirectionsField: (field) => set({ activeDirectionsField: field }),
  setPickingRouteField: (field) => set({ pickingRouteField: field }),
  clearPickingRouteField: () => set({ pickingRouteField: null }),
  setTheme: (theme) => set({ theme }),
  setThemeOverride: (override) => {
    set({ themeOverride: override })
    if (override) {
      localStorage.setItem('navi-theme-override', override)
    } else {
      localStorage.removeItem('navi-theme-override')
    }
  },

  // ── Auth state ──
  auth: { authenticated: false, username: null, loaded: false },
  setAuth: (auth) => set({ auth: { ...auth, loaded: true } }),

  // ── Contacts ──
  contacts: [],
  contactsLoaded: false,
  activeTab: 'routes', // 'routes' | 'contacts'
  editingContact: null, // null=closed, {}=new, {id:N}=edit
  pickingLocationFor: null, // form data while user picks location on map

  setContacts: (c) => set({ contacts: c, contactsLoaded: true }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setEditingContact: (c) => set({ editingContact: c }),
  clearEditingContact: () => set({ editingContact: null }),
  setPickingLocationFor: (formData) => set({ pickingLocationFor: formData }),
  clearPickingLocationFor: () => set({ pickingLocationFor: null }),
}))

// ── Panel state selector ──
// Returns string state, prioritizing preview to allow it alongside any route state
export const usePanelState = () => {
  return useStore((s) => {
    const hasPreview = !!s.selectedPlace
    const hasRoute = !!s.routeResult
    const hasRoutePoints = !!s.routeStart || !!s.routeEnd

    if (hasPreview && hasRoute) return "PREVIEW_CALCULATED"
    if (hasPreview && hasRoutePoints) return "PREVIEW_ROUTING"
    if (hasPreview) return "PREVIEW"
    if (hasRoute) return "ROUTE_CALCULATED"
    if (hasRoutePoints) return "ROUTING"
    return "IDLE"
  })
}
