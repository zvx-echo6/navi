import { useStore } from '../store'

const MODES = [
  { id: 'auto', label: 'Drive', icon: '🚗' },
  { id: 'pedestrian', label: 'Walk', icon: '🚶' },
  { id: 'bicycle', label: 'Bike', icon: '🚴' },
]

export default function ModeSelector() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Travel mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          onClick={() => setMode(m.id)}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
            mode === m.id
              ? 'bg-cyan-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <span className="mr-1">{m.icon}</span>
          {m.label}
        </button>
      ))}
    </div>
  )
}
