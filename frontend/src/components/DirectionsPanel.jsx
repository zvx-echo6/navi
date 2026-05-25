import { useEffect, useMemo } from "react"
import { ArrowUpDown, Plus, X, Footprints, Bike, Car, Shield, AlertTriangle, Zap, Trash2, GripVertical } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useStore } from "../store"
import LocationInput from "./LocationInput"
import ManeuverList from "./ManeuverList"

const TRAVEL_MODES = [
  { id: "auto", label: "Auto", Icon: Zap },
  { id: "foot", label: "Foot", Icon: Footprints },
  { id: "2w", label: "MTB", Icon: Bike },
  { id: "4w", label: "ATV", Icon: Car },
  { id: "vehicle", label: "Drive", Icon: Car },
]

// Maps the backend's selected_mode to the chip label shown in the "Auto chose X" badge.
const SELECTED_MODE_LABEL = { vehicle: "Drive", "4w": "ATV", "2w": "MTB", foot: "Foot" }

const BOUNDARY_MODES = [
  { id: "strict", label: "Strict", Icon: Shield, title: "Avoid barriers" },
  { id: "pragmatic", label: "Cross", Icon: AlertTriangle, title: "Cross with penalty" },
  { id: "emergency", label: "Ignore", Icon: Zap, title: "Ignore barriers" },
]

// Sortable row component
function SortableRow({ id, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1">
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-1 rounded cursor-grab active:cursor-grabbing hover:bg-[var(--bg-overlay)] transition-colors shrink-0 touch-none"
        title="Drag to reorder"
      >
        <GripVertical size={14} style={{ color: "var(--text-tertiary)" }} />
      </button>
      {children}
    </div>
  )
}

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
  const addIntermediateStop = useStore((s) => s.addIntermediateStop)
  const updateStop = useStore((s) => s.updateStop)
  const removeStop = useStore((s) => s.removeStop)
  const setStops = useStore((s) => s.setStops)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Build unified list for drag-and-drop: origin + stops + destination
  // Each item has: { id, type, data }
  const unifiedList = useMemo(() => {
    const items = []
    // Always render origin first and destination last, even when unset (data:null);
    // LocationInput shows its placeholder for value={null}. Stops sit in between.
    items.push({ id: "origin", type: "origin", data: routeStart })
    stops.forEach((stop) => {
      items.push({ id: stop.id, type: "stop", data: stop })
    })
    items.push({ id: "destination", type: "destination", data: routeEnd })
    return items
  }, [routeStart, stops, routeEnd])

  const itemIds = useMemo(() => unifiedList.map((item) => item.id), [unifiedList])

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

  const handleClose = () => {
    clearRoute()
    setDirectionsMode(false)
    onClose?.()
  }

  const handleAddStop = () => {
    addIntermediateStop()
  }

  // Handle drag end - reorder the unified list
  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = unifiedList.findIndex((item) => item.id === active.id)
    const newIndex = unifiedList.findIndex((item) => item.id === over.id)

    if (oldIndex === -1 || newIndex === -1) return

    // Reorder the unified list
    const reordered = arrayMove(unifiedList, oldIndex, newIndex)

    // Extract new origin, stops, and destination from reordered list
    // First item becomes origin, last becomes destination, middle are stops
    if (reordered.length === 0) return

    const newOriginItem = reordered[0]
    const newDestItem = reordered.length > 1 ? reordered[reordered.length - 1] : null
    const newStopItems = reordered.length > 2 ? reordered.slice(1, -1) : []

    // Convert items to proper format
    const newOrigin = newOriginItem.data ? {
      lat: newOriginItem.data.lat,
      lon: newOriginItem.data.lon,
      name: newOriginItem.data.name,
      source: newOriginItem.data.source,
      category: newOriginItem.data?.category ?? null,
    } : null

    const newDest = newDestItem?.data ? {
      lat: newDestItem.data.lat,
      lon: newDestItem.data.lon,
      name: newDestItem.data.name,
      source: newDestItem.data.source,
      category: newDestItem.data?.category ?? null,
    } : null

    const newStops = newStopItems.map((item) => ({
      id: item.id === "origin" || item.id === "destination" ? crypto.randomUUID() : item.id,
      lat: item.data?.lat ?? null,
      lon: item.data?.lon ?? null,
      name: item.data?.name ?? "",
    }))

    // Update state
    setRouteStart(newOrigin)
    setRouteEnd(newDest)
    setStops(newStops)

    // Trigger route recalculation
    setTimeout(() => computeRoute(), 0)
  }

  // Check if route has wilderness segments
  const hasWilderness = routeResult?.summary?.wilderness_distance_km > 0

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

      {/* Drag-and-drop location list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {unifiedList.map((item, idx) => (
              <SortableRow key={item.id} id={item.id}>
                <div className="flex-1">
                  {item.type === "origin" && (
                    <LocationInput
                      value={routeStart}
                      onChange={setRouteStart}
                      placeholder={geoPermission === "granted" ? "Your location" : "Choose starting point"}
                      icon="origin"
                      fieldId="origin"
                      autoFocus={!routeStart}
                    />
                  )}
                  {item.type === "destination" && (
                    <LocationInput
                      value={routeEnd}
                      onChange={setRouteEnd}
                      placeholder="Choose destination"
                      icon="destination"
                      fieldId="destination"
                      autoFocus={routeStart && !routeEnd}
                    />
                  )}
                  {item.type === "stop" && (
                    <LocationInput
                      value={item.data.lat != null ? { lat: item.data.lat, lon: item.data.lon, name: item.data.name } : null}
                      onChange={(place) => {
                        if (place) {
                          updateStop(item.id, place)
                        }
                      }}
                      placeholder={`Stop ${idx}`}
                      icon="stop"
                      fieldId={`stop-${item.id}`}
                      autoFocus={item.data.lat == null}
                    />
                  )}
                </div>
                {/* Remove button for intermediate stops only */}
                {item.type === "stop" && (
                  <button
                    onClick={() => removeStop(item.id)}
                    className="p-1.5 rounded-lg hover:bg-[var(--bg-overlay)] transition-colors shrink-0"
                    title="Remove stop"
                  >
                    <Trash2 size={14} style={{ color: "var(--text-tertiary)" }} />
                  </button>
                )}
                {/* Spacer for origin/destination to align with stops that have remove button */}
                {item.type !== "stop" && (
                  <div className="w-[30px] shrink-0" />
                )}
              </SortableRow>
            ))}

            {/* Add stop button - only show when route exists */}
            {routeStart && routeEnd && stops.length < 8 && (
              <button
                onClick={handleAddStop}
                className="flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg transition-colors ml-6"
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
        </SortableContext>
      </DndContext>

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

      {/* Auto mode: show which travel mode feasibility picked */}
      {routeMode === "auto" && routeResult?.selected_mode && (
        <div
          className="flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg"
          style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
        >
          <Zap size={14} />
          <span>{`Auto chose ${SELECTED_MODE_LABEL[routeResult.selected_mode] || routeResult.selected_mode}`}</span>
        </div>
      )}

      {/* Boundary mode selector — hidden only for Drive (vehicle), which is pure
          Valhalla road routing; Auto/Foot/MTB/ATV may traverse wilderness. */}
      {routeMode !== "vehicle" && (
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
