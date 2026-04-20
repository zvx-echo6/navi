import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X, GripVertical } from 'lucide-react'
import { useStore } from '../store'

export default function StopItem({ stop, index, total, indexOffset = 0 }) {
  const removeStop = useStore((s) => s.removeStop)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const displayIndex = index + indexOffset
  const effectiveTotal = total + indexOffset

  // Pin color from tokens
  let pinVar = '--pin-intermediate'
  if (displayIndex === 0) pinVar = '--pin-origin'
  else if (displayIndex === effectiveTotal - 1 && effectiveTotal > 1) pinVar = '--pin-destination'

  const pinLabel = String.fromCharCode(65 + Math.min(displayIndex, 25))

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-subtle)',
      }}
      className="flex items-center gap-2 py-1.5 px-2 rounded group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>

      {/* Pin indicator */}
      <span
        className="text-[10px] font-semibold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: `var(${pinVar})`,
          color: '#fff',
          border: '1.5px solid var(--pin-stroke)',
        }}
      >
        {pinLabel}
      </span>

      {/* Stop name */}
      <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-primary)' }}>
        {stop.name}
      </span>

      {/* Remove button */}
      <button
        onClick={() => removeStop(stop.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label={`Remove stop ${stop.name}`}
      >
        <X size={14} />
      </button>
    </div>
  )
}
