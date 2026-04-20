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

export default function StopList() {
  const stops = useStore((s) => s.stops)
  const reorderStops = useStore((s) => s.reorderStops)
  const geoPermission = useStore((s) => s.geoPermission)

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

  if (stops.length === 0) {
    return (
      <div className="text-gray-500 text-xs px-2 py-3 text-center">
        {geoPermission === 'denied'
          ? 'Add a starting point and destination above'
          : 'Search and add stops to build your route'}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1">
          {stops.map((stop, i) => (
            <StopItem key={stop.id} stop={stop} index={i} total={stops.length} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
