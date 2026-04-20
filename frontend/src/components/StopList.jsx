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
} from '@dnd-kit/sortable'
import { useStore } from '../store'
import StopItem from './StopItem'
import GpsOriginItem from './GpsOriginItem'

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
    <div className="flex flex-col gap-1">
      {hasGpsOrigin && <GpsOriginItem />}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {stops.map((stop, i) => (
            <StopItem
              key={stop.id}
              stop={stop}
              index={i}
              total={stops.length}
              indexOffset={indexOffset}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
