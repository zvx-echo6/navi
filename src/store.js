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

  // ── Stop list ──
  stops: [],
  // Each stop: { id, lat, lon, name, source, matchCode, isOrigin }

  addStop: (stop) => {
    const { stops } = get()
    if (stops.length >= 10) return false
    set({ stops: [...stops, { ...stop, id: crypto.randomUUID() }] })
    return true
  },

  removeStop: (id) => {
    set({ stops: get().stops.filter((s) => s.id !== id) })
  },

  reorderStops: (newStops) => set({ stops: newStops }),

  clearStops: () => set({ stops: [] }),

  setStops: (stops) => set({ stops }),

  // ── Geolocation ──
  userLocation: null, // { lat, lon }
  geoPermission: 'prompt', // 'prompt' | 'granted' | 'denied'

  setUserLocation: (loc) => set({ userLocation: loc }),
  setGeoPermission: (p) => set({ geoPermission: p }),

  // ── Mode ──
  mode: 'auto', // 'auto' | 'pedestrian' | 'bicycle'
  setMode: (mode) => set({ mode }),

  // ── Route ──
  route: null, // Valhalla response (trip object)
  routeLoading: false,
  routeError: null,

  setRoute: (route) => set({ route, routeError: null }),
  setRouteLoading: (loading) => set({ routeLoading: loading }),
  setRouteError: (err) => set({ routeError: err, route: null }),
  clearRoute: () => set({ route: null, routeError: null }),

  // ── UI state ──
  sheetState: 'half', // 'collapsed' | 'half' | 'full'
  panelOpen: true,
  autocompleteOpen: false,

  setSheetState: (s) => set({ sheetState: s }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setAutocompleteOpen: (open) => set({ autocompleteOpen: open }),
}))
