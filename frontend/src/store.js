import { create } from 'zustand'

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
  routeMode: "foot", // foot | mtb | atv | vehicle
  boundaryMode: "strict", // strict | pragmatic | emergency
  routeResult: null, // Response from /api/offroute
  routeLoading: false,
  routeError: null,

  setRouteStart: (place) => set({ routeStart: place, routeResult: null, routeError: null }),
  setRouteEnd: (place) => set({ routeEnd: place }),
  setRouteMode: (mode) => set({ routeMode: mode }),
  setBoundaryMode: (mode) => set({ boundaryMode: mode }),
  setRouteResult: (result) => set({ routeResult: result, routeError: null }),
  setRouteLoading: (loading) => set({ routeLoading: loading }),
  setRouteError: (err) => set({ routeError: err, routeResult: null }),
  clearRoute: () => set({
    routeStart: null,
    routeEnd: null,
    routeResult: null,
    routeError: null
  }),

  // ── Legacy compatibility (for components not yet migrated) ──
  stops: [],
  gpsOrigin: false,
  pendingDestination: null,
  route: null,

  addStop: (stop) => {
    // Legacy: just set as route end point
    const { routeStart, setRouteEnd } = get()
    const place = { lat: stop.lat, lon: stop.lon, name: stop.name }
    if (!routeStart) {
      set({ routeStart: place, stops: [{ ...stop, id: crypto.randomUUID() }] })
    } else {
      setRouteEnd(place)
      set({ stops: [...get().stops, { ...stop, id: crypto.randomUUID() }] })
    }
    return true
  },
  removeStop: (id) => {
    const { stops } = get()
    const newStops = stops.filter((s) => s.id !== id)
    set({ stops: newStops })
    if (newStops.length === 0) {
      get().clearRoute()
    }
  },
  clearStops: () => set({ stops: [], routeStart: null, routeEnd: null }),
  setStops: (stops) => set({ stops }),
  reorderStops: (newStops) => set({ stops: newStops }),
  setGpsOrigin: (val) => set({ gpsOrigin: val }),
  setPendingDestination: (place) => set({ pendingDestination: place }),
  clearPendingDestination: () => set({ pendingDestination: null }),

  startDirections: (place) => {
    // Legacy: set as destination
    const { routeStart, setRouteEnd, clearRoute } = get()
    clearRoute()
    set({
      routeEnd: { lat: place.lat, lon: place.lon, name: place.name },
      stops: [{ ...place, id: crypto.randomUUID() }],
      selectedPlace: null
    })
  },

  // ── Place detail ──
  selectedPlace: null,
  clickMarker: null,

  setSelectedPlace: (place) => set({ selectedPlace: place }),
  updateBoundary: null,
  setUpdateBoundary: (fn) => set({ updateBoundary: fn }),
  clearSelectedPlace: () => set({ selectedPlace: null, clickMarker: null }),
  setClickMarker: (marker) => set({ clickMarker: marker }),
  clearClickMarker: () => set({ clickMarker: null }),

  // ── UI state ──
  sheetState: 'half',
  panelOpen: true,
  autocompleteOpen: false,
  theme: 'dark',
  themeOverride: null,
  viewMode: (typeof localStorage !== 'undefined' && localStorage.getItem('navi-view-mode')) || 'map',

  setSheetState: (s) => set({ sheetState: s }),
  setViewMode: (mode) => {
    set({ viewMode: mode })
    localStorage.setItem('navi-view-mode', mode)
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
  setAutocompleteOpen: (open) => set({ autocompleteOpen: open }),
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
  activeTab: 'routes',
  editingContact: null,
  pickingLocationFor: null,

  setContacts: (c) => set({ contacts: c, contactsLoaded: true }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setEditingContact: (c) => set({ editingContact: c }),
  clearEditingContact: () => set({ editingContact: null }),
  setPickingLocationFor: (formData) => set({ pickingLocationFor: formData }),
  clearPickingLocationFor: () => set({ pickingLocationFor: null }),
}))

// ── Panel state selector ──
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
