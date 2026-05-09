import { useEffect } from "react"
import { ArrowUpDown, Plus, X, Footprints, Bike, Car, Shield, AlertTriangle, Zap } from "lucide-react"
import { useStore } from "../store"
import LocationInput from "./LocationInput"
import ManeuverList from "./ManeuverList"

const TRAVEL_MODES = [
  { id: "auto", label: "Drive", Icon: Car },
  { id: "foot", label: "Foot", Icon: Footprints },
  { id: "mtb", label: "MTB", Icon: Bike },
  { id: "atv", label: "ATV", Icon: Car },
  { id: "vehicle", label: "4x4", Icon: Car },
]

const BOUNDARY_MODES = [
  { id: "strict", label: "Strict", Icon: Shield, title: "Avoid barriers" },
  { id: "pragmatic", label: "Cross", Icon: AlertTriangle, title: "Cross with penalty" },
  { id: "emergency", label: "Ignore", Icon: Zap, title: "Ignore barriers" },
]

export default function DirectionsPanel({ onClose }) {
  const routeStart = useStore((s) => s.routeStart)
  const routeEnd = useStore((s) => s.routeEnd)
  const routeMode = useStore((s) => s.routeMode)
  const boundaryMode = useStore((s) => s.boundaryMode)
  const routeResult = useStore((s) => s.routeResult)
  const routeLoading = useStore((s) => s.routeLoading)
  const routeError = useStore((s) => s.routeError)
  const stops = useStore((s) => s.stops)
  const userLocation = useStore((s) => s.userLocation)
  const geoPermission = useStore((s) => s.geoPermission)

  const setRouteStart = useStore((s) => s.setRouteStart)
  const setRouteEnd = useStore((s) => s.setRouteEnd)
  const setRouteMode = useStore((s) => s.setRouteMode)
  const setBoundaryMode = useStore((s) => s.setBoundaryMode)
  const computeRoute = useStore((s) => s.computeRoute)
  const clearRoute = useStore((s) => s.clearRoute)
  const setDirectionsMode = useStore((s) => s.setDirectionsMode)
  const addStop = useStore((s) => s.addStop)
  const removeStop = useStore((s) => s.removeStop)
  const reorderStops = useStore((s) => s.reorderStops)

  // Auto-fill origin with GPS if available and origin is empty
  useEffect(() => {
    if (!routeStart && geoPermission === "granted" && userLocation) {
      setRouteStart({
        lat: userLocation.lat,
        lon: userLocation.lon,
        name: "Your location",
        source: "gps",
      })
    }
  }, [routeStart, geoPermission, userLocation, setRouteStart])

  // Auto-compute route when both endpoints are set
  useEffect(() => {
    if (routeStart && routeEnd) {
      computeRoute()
    }
  }, [routeStart?.lat, routeStart?.lon, routeEnd?.lat, routeEnd?.lon])

  const handleSwap = () => {
    const tempStart = routeStart
    const tempEnd = routeEnd
    setRouteStart(tempEnd)
    setRouteEnd(tempStart)
  }

  const handleClose = () => {
    clearRoute()
    setDirectionsMode(false)
    onClose?.()
  }

  const handleAddStop = () => {
    // For now, show a message - multi-stop UI is complex
    // TODO: Implement full multi-stop UI
  }

  // Check if route has wilderness segments
  const hasWilderness = routeResult?.summary?.wilderness_distance_km > 0

  // Multi-stop support: show intermediate stops from the stops array
  const intermediateStops = stops.slice(1, -1)

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Directions
        </span>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-overlay)] transition-colors"
          title="Close directions"
        >
          <X size={18} style={{ color: "var(--text-tertiary)" }} />
        </button>
      </div>

      {/* Origin/Destination inputs with swap button */}
      <div className="relative flex flex-col gap-2">
        {/* Origin */}
        <LocationInput
          value={routeStart}
          onChange={setRouteStart}
          placeholder={geoPermission === "granted" ? "Your location" : "Choose starting point"}
          icon="origin"
          fieldId="origin"
          autoFocus={!routeStart}
        />

        {/* Swap button - positioned between inputs */}
        <button
          onClick={handleSwap}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full transition-colors"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
          }}
          title="Swap origin and destination"
        >
          <ArrowUpDown size={14} style={{ color: "var(--text-secondary)" }} />
        </button>

        {/* Intermediate stops (for multi-stop routes) */}
        {intermediateStops.map((stop, idx) => (
          <div key={stop.id} className="relative">
            <LocationInput
              value={{ lat: stop.lat, lon: stop.lon, name: stop.name }}
              onChange={(place) => {
                if (place) {
                  const newStops = [...stops]
                  newStops[idx + 1] = { ...newStops[idx + 1], ...place }
                  reorderStops(newStops)
                } else {
                  removeStop(stop.id)
                }
              }}
              placeholder="Stop"
              icon="stop"
              fieldId={`stop-${idx}`}
            />
          </div>
        ))}

        {/* Destination */}
        <LocationInput
          value={routeEnd}
          onChange={setRouteEnd}
          placeholder="Choose destination"
          icon="destination"
          fieldId="destination"
          autoFocus={routeStart && !routeEnd}
        />

        {/* Add stop button - only show when route exists */}
        {routeStart && routeEnd && stops.length < 10 && (
          <button
            onClick={handleAddStop}
            className="flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: "var(--bg-overlay)",
              color: "var(--text-secondary)",
              border: "1px dashed var(--border)",
            }}
          >
            <Plus size={14} />
            <span>Add stop</span>
          </button>
        )}
      </div>

      {/* Travel mode selector */}
      <div className="flex gap-1">
        {TRAVEL_MODES.map((m) => {
          const active = routeMode === m.id
          return (
            <button
              key={m.id}
              onClick={() => setRouteMode(m.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded-lg transition-colors"
              style={{
                background: active ? "var(--accent-muted)" : "var(--bg-overlay)",
                color: active ? "var(--accent)" : "var(--text-tertiary)",
              }}
              title={m.label}
            >
              <m.Icon size={16} />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* Boundary mode selector (only for non-auto modes) */}
      {routeMode !== "auto" && (
        <div className="flex gap-1">
          {BOUNDARY_MODES.map((m) => {
            const active = boundaryMode === m.id
            return (
              <button
                key={m.id}
                onClick={() => setBoundaryMode(m.id)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg transition-colors"
                style={{
                  background: active ? "var(--accent-muted)" : "var(--bg-overlay)",
                  color: active ? "var(--accent)" : "var(--text-tertiary)",
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

      {/* Loading indicator */}
      {routeLoading && (
        <div className="flex items-center justify-center gap-2 py-3">
          <div
            className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          />
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Finding route...
          </span>
        </div>
      )}

      {/* Error message - friendly text, no "offroute" */}
      {routeError && (
        <div
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: "var(--error-bg, rgba(239, 68, 68, 0.1))",
            color: "var(--error, #ef4444)",
          }}
        >
          {routeError.includes("No route") || routeError.includes("not found")
            ? "No route found. Try a different start point or mode."
            : routeError.includes("entry point")
            ? "No roads found nearby — try Foot mode for trails."
            : routeError}
        </div>
      )}

      {/* Route legend - only shown when route has wilderness segment */}
      {routeResult && hasWilderness && !routeLoading && (
        <div
          className="flex items-center gap-4 px-3 py-2 rounded-lg text-xs"
          style={{ background: "var(--bg-overlay)" }}
        >
          <div className="flex items-center gap-1.5">
            <svg width="24" height="2" style={{ overflow: "visible" }}>
              <line
                x1="0" y1="1" x2="24" y2="1"
                stroke="#f97316"
                strokeWidth="3"
                strokeDasharray="4,3"
              />
            </svg>
            <span style={{ color: "var(--text-secondary)" }}>Wilderness (on foot)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="24" height="2" style={{ overflow: "visible" }}>
              <line
                x1="0" y1="1" x2="24" y2="1"
                stroke="#3b82f6"
                strokeWidth="3"
              />
            </svg>
            <span style={{ color: "var(--text-secondary)" }}>Road/Trail</span>
          </div>
        </div>
      )}

      {/* Route summary and maneuvers */}
      {routeResult && !routeLoading && (
        <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <ManeuverList />
        </div>
      )}

      {/* Hint when waiting for input */}
      {!routeStart && !routeEnd && !routeLoading && (
        <div className="text-center py-4">
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            Enter addresses, paste coordinates, or click the map
          </p>
        </div>
      )}
    </div>
  )
}
