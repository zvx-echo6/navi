import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'

export default function StopItem({ stop, index, total }) {
  const removeStop = useStore((s) => s.removeStop)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Pin color logic
  let pinColor = 'bg-blue-500' // intermediate
  let pinLabel = String(index + 1)
  if (index === 0) {
    pinColor = 'bg-green-500'
    pinLabel = 'A'
  } else if (index === total - 1 && total > 1) {
    pinColor = 'bg-red-500'
    pinLabel = String.fromCharCode(65 + Math.min(index, 25)) // A-Z
  } else {
    pinLabel = String.fromCharCode(65 + Math.min(index, 25))
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-2 bg-gray-800/60 rounded border border-gray-700 group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300 touch-none"
        aria-label="Drag to reorder"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="4" cy="2" r="1" />
          <circle cx="8" cy="2" r="1" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="8" cy="6" r="1" />
          <circle cx="4" cy="10" r="1" />
          <circle cx="8" cy="10" r="1" />
        </svg>
      </button>

      {/* Pin indicator */}
      <span
        className={`${pinColor} text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0`}
      >
        {pinLabel}
      </span>

      {/* Stop name */}
      <span className="flex-1 text-sm text-gray-200 truncate">{stop.name}</span>

      {/* Remove button */}
      <button
        onClick={() => removeStop(stop.id)}
        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
        aria-label={`Remove stop ${stop.name}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
