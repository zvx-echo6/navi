import { Car, Footprints, Bike } from 'lucide-react'
import { useStore } from '../store'

const MODES = [
  { id: 'auto', label: 'Drive', Icon: Car },
  { id: 'pedestrian', label: 'Walk', Icon: Footprints },
  { id: 'bicycle', label: 'Bike', Icon: Bike },
]

export default function ModeSelector() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  return (
    <div
      className="flex rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
      role="radiogroup"
      aria-label="Travel mode"
    >
      {MODES.map((m) => {
        const active = mode === m.id
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={active}
            onClick={() => setMode(m.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium transition-colors duration-100"
            style={{
              background: active ? 'var(--accent-muted)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              borderRight: m.id !== 'bicycle' ? '1px solid var(--border)' : 'none',
            }}
          >
            <m.Icon size={14} />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
