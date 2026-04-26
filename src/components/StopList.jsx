import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import { PlaceCard } from './PlaceCard'
import GpsOriginItem from './GpsOriginItem'

// Wrapper to make PlaceCard sortable
function SortableStopCard({ stop, index, indexOffset }) {
  const removeStop = useStore((s) => s.removeStop)
  const [expanded, setExpanded] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Convert stop to place format for PlaceCard
  const place = {
    lat: stop.lat,
    lon: stop.lon,
    name: stop.name,
    source: stop.source,
    matchCode: stop.matchCode,
    type: stop.type || null,
    raw: stop.raw || null,
    wikidata: stop.wikidata || null,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <PlaceCard
        place={place}
        variant="stop"
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
        onRemove={() => removeStop(stop.id)}
        stopIndex={index + indexOffset}
        draggable={true}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export default function StopList() {
  const stops = useStore((s) => s.stops)
  const reorderStops = useStore((s) => s.reorderStops)
  const geoPermission = useStore((s) => s.geoPermission)
  const gpsOrigin = useStore((s) => s.gpsOrigin)
  const pendingDestination = useStore((s) => s.pendingDestination)

  const hasGpsOrigin = gpsOrigin && geoPermission === 'granted'
  const indexOffset = hasGpsOrigin ? 1 : 0

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = stops.findIndex((s) => s.id === active.id)
    const newIndex = stops.findIndex((s) => s.id === over.id)
    reorderStops(arrayMove(stops, oldIndex, newIndex))
  }

  if (stops.length === 0 && !hasGpsOrigin) {
    return (
      <div className="text-xs px-2 py-3 text-center" style={{ color: 'var(--text-tertiary)' }}>
        {pendingDestination
          ? 'Search for a starting point above'
          : geoPermission === 'denied'
            ? 'Add a starting point and destination above'
            : 'Search and add stops to build your route'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {hasGpsOrigin && <GpsOriginItem />}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {stops.map((stop, i) => (
            <SortableStopCard
              key={stop.id}
              stop={stop}
              index={i}
              indexOffset={indexOffset}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
