import { create } from "zustand"
import { requestOffroute } from "./api"

export const useStore = create((set, get) => ({
  // ── Search state ──
  query: "",
  results: [],
  searchLoading: false,
  abortController: null,

  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSearchLoading: (loading) => set({ searchLoading: loading }),
  setAbortController: (ctrl) => set({ abortController: ctrl }),

  // ── Geolocation ──
  userLocation: null, // { lat, lon }
  geoPermission: "prompt", // "prompt" | "granted" | "denied"

  setUserLocation: (loc) => set({ userLocation: loc }),
  setGeoPermission: (p) => set({ geoPermission: p }),

  // ── Map viewport (for search bias) ──
  mapCenter: null, // { lat, lon, zoom }
  setMapCenter: (center) => set({ mapCenter: center }),

  // ── Unified Route State ──
  // routeStart = origin (source of truth)
  // routeEnd = destination (source of truth)
  // stops[] = ONLY intermediate waypoints (not origin/destination)
  routeStart: null, // { lat, lon, name }
  routeEnd: null, // { lat, lon, name }
  stops: [], // Intermediate waypoints only: [{ id, lat, lon, name }, ...]
  routeMode: "auto", // auto | foot | 2w | 4w | vehicle
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
      stops: [],
      routeResult: null,
      routeError: null,
    })
  },

  // ── INTERMEDIATE STOPS MANAGEMENT ──
  // stops[] contains ONLY intermediate waypoints, not origin/destination

  // Add intermediate stop - can be called with or without place
  // With place: creates pre-filled stop (from radial menu)
  // Without place: creates empty placeholder (from Add Stop button)
  addIntermediateStop: (place) => {
    const { stops } = get()
    if (stops.length >= 8) return false // Max 8 intermediate stops
    const newStop = {
      id: crypto.randomUUID(),
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      name: place?.name ?? "",
    }
    set({ stops: [...stops, newStop] })
    return true
  },

  updateStop: (id, place) => {
    const { stops } = get()
    const newStops = stops.map((s) =>
      s.id === id ? { ...s, lat: place.lat, lon: place.lon, name: place.name } : s
    )
    set({ stops: newStops })
    // Trigger route recalculation if all waypoints have coordinates
    get().computeRoute()
  },

  removeStop: (id) => {
    const { stops } = get()
    const newStops = stops.filter((s) => s.id !== id)
    set({ stops: newStops })
    // Recalculate route without this stop
    get().computeRoute()
  },

  setStops: (stops) => set({ stops }),

  // ── UNIFIED ROUTING TRIGGER ──
  // Handles both 2-point and multi-point routing
  computeRoute: async () => {
    const { routeStart, routeEnd, stops, routeMode, boundaryMode, _updateRouteDisplay } = get()

    // Need both endpoints to route
    if (!routeStart || !routeEnd) return

    // Filter out incomplete stops (no coordinates yet)
    const validStops = stops.filter((s) => s.lat != null && s.lon != null)

    // Build full waypoint list: [origin, ...intermediates, destination]
    const waypoints = [
      routeStart,
      ...validStops,
      routeEnd,
    ]

    console.log("[TRACE-ROUTE] computeRoute with waypoints:", waypoints.length, waypoints.map(w => w.name))

    set({ routeLoading: true, routeError: null })

    try {
      if (waypoints.length === 2) {
        // Simple 2-point routing
        const data = await requestOffroute(routeStart, routeEnd, routeMode, boundaryMode, routeStart.category, routeEnd.category)
        if (data.status === "ok" && data.route) {
          set({ routeResult: data, routeError: null })
          if (_updateRouteDisplay) _updateRouteDisplay(data.route)
        } else {
          set({ routeError: data.message || data.error || "No route found", routeResult: null })
        }
      } else {
        // Multi-point routing: chain sequential 2-point routes and merge
        const segments = []
        let totalDistanceKm = 0
        let totalEffortMinutes = 0
        let allFeatures = []

        for (let i = 0; i < waypoints.length - 1; i++) {
          const from = waypoints[i]
          const to = waypoints[i + 1]
          const segmentData = await requestOffroute(from, to, routeMode, boundaryMode, from.category, to.category)

          if (segmentData.status !== "ok" || !segmentData.route) {
            throw new Error("No route found between " + (from.name || "waypoint") + " and " + (to.name || "waypoint"))
          }

          segments.push(segmentData)

          // Accumulate totals
          if (segmentData.summary) {
            totalDistanceKm += segmentData.summary.total_distance_km || 0
            totalEffortMinutes += segmentData.summary.total_effort_minutes || 0
          }

          // Collect features
          if (segmentData.route?.features) {
            allFeatures.push(...segmentData.route.features)
          }
        }

        // Build merged result
        const mergedResult = {
          status: "ok",
          summary: {
            total_distance_km: totalDistanceKm,
            total_effort_minutes: totalEffortMinutes,
            waypoint_count: waypoints.length,
          },
          route: {
            type: "FeatureCollection",
            features: allFeatures,
          },
        }

        set({ routeResult: mergedResult, routeError: null })
        if (_updateRouteDisplay) _updateRouteDisplay(mergedResult.route)
      }
    } catch (e) {
      set({ routeError: e.message, routeResult: null })
    } finally {
      set({ routeLoading: false })
    }
  },

  // ── Legacy compatibility ──
  gpsOrigin: true,
  pendingDestination: null,
  setGpsOrigin: (val) => set({ gpsOrigin: val }),
  setPendingDestination: (place) => set({ pendingDestination: place }),
  clearPendingDestination: () => set({ pendingDestination: null }),

  // Master startDirections - enters directions mode with destination pre-filled
  startDirections: (place) => {
    console.log("[TRACE-STORE] startDirections received place:", { lat: place?.lat, lon: place?.lon, name: place?.name })
    const { geoPermission, userLocation, clearRoute } = get()
    clearRoute()

    const destination = {
      lat: place.lat,
      lon: place.lon,
      name: place.name,
      source: place.source,
      matchCode: place.matchCode,
      category: place.category ?? null,  // preserve OSM key:value hint for Auto mode
    }

    let origin = null
    if (geoPermission === "granted" && userLocation) {
      origin = {
        lat: userLocation.lat,
        lon: userLocation.lon,
        name: "Your location",
        source: "gps",
      }
    }

    set({
      routeEnd: destination,
      routeStart: origin,
      directionsMode: true,
      activeDirectionsField: origin ? null : "origin",
      selectedPlace: null,
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
  sheetState: "half",
  panelOpen: true,
  autocompleteOpen: false,
  directionsMode: false,
  activeDirectionsField: null,
  pickingRouteField: null,
  theme: "dark",
  themeOverride: null,
  viewMode: (typeof localStorage !== "undefined" && localStorage.getItem("navi-view-mode")) || "map",

  setSheetState: (s) => set({ sheetState: s }),
  setViewMode: (mode) => {
    set({ viewMode: mode })
    localStorage.setItem("navi-view-mode", mode)
  },
  setPanelOpen: (open) => set({ panelOpen: open }),
  setAutocompleteOpen: (open) => set({ autocompleteOpen: open }),
  setDirectionsMode: (mode) => set({ directionsMode: mode, activeDirectionsField: mode ? "origin" : null }),
  setActiveDirectionsField: (field) => set({ activeDirectionsField: field }),
  setPickingRouteField: (field) => set({ pickingRouteField: field }),
  clearPickingRouteField: () => set({ pickingRouteField: null }),
  setTheme: (theme) => set({ theme }),
  setThemeOverride: (override) => {
    set({ themeOverride: override })
    if (override) {
      localStorage.setItem("navi-theme-override", override)
    } else {
      localStorage.removeItem("navi-theme-override")
    }
  },

  // ── Auth state ──
  auth: { authenticated: false, username: null, loaded: false },
  setAuth: (auth) => set({ auth: { ...auth, loaded: true } }),

  // ── Contacts ──
  contacts: [],
  contactsLoaded: false,
  activeTab: "routes",
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
