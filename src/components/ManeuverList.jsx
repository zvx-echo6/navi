import {
  MoveRight, MoveUpRight, MoveDownRight, CornerUpRight, CornerUpLeft,
  MoveLeft, MoveUpLeft, MoveDownLeft, CircleDot, RotateCw,
  GitMerge, CornerRightDown, CornerRightUp, Navigation
} from 'lucide-react'
import { useStore } from '../store'

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatDist(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

function ManeuverIcon({ type }) {
  const size = 16
  const props = { size, strokeWidth: 1.5 }
  switch (type) {
    case 0: return <MoveRight {...props} />
    case 1: return <MoveUpRight {...props} />
    case 2: return <CornerUpRight {...props} />
    case 3: return <MoveDownRight {...props} />
    case 4: case 5: return <CornerUpLeft {...props} />
    case 6: return <MoveDownLeft {...props} />
    case 7: return <CornerUpLeft {...props} />
    case 8: return <MoveUpLeft {...props} />
    case 9: return <Navigation {...props} />
    case 10: case 11: case 12: return <CircleDot {...props} />
    case 15: case 16: return <RotateCw {...props} />
    case 24: return <GitMerge {...props} />
    case 25: return <CornerRightUp {...props} />
    case 26: return <CornerRightDown {...props} />
    default: return <MoveRight {...props} />
  }
}

export default function ManeuverList({ onManeuverClick }) {
  const route = useStore((s) => s.route)
  const routeLoading = useStore((s) => s.routeLoading)
  const routeError = useStore((s) => s.routeError)

  if (routeLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div
          className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
        />
        <span className="ml-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Calculating route...
        </span>
      </div>
    )
  }

  if (routeError) {
    return (
      <div
        className="px-3 py-2 rounded text-sm"
        style={{
          background: 'color-mix(in srgb, var(--status-danger) 15%, transparent)',
          border: '1px solid var(--status-danger)',
          color: 'var(--status-danger)',
        }}
      >
        {routeError}
      </div>
    )
  }

  if (!route || !route.legs) return null

  const totalTime = route.summary?.time || 0
  const totalDist = route.summary?.length || 0

  const allManeuvers = []
  let timeRemaining = totalTime

  for (let legIdx = 0; legIdx < route.legs.length; legIdx++) {
    const leg = route.legs[legIdx]
    for (const man of leg.maneuvers || []) {
      allManeuvers.push({ ...man, _legIndex: legIdx, timeRemaining })
      timeRemaining -= man.time || 0
    }
  }

  return (
    <div className="flex flex-col">
      {/* Route summary */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded mb-2"
        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
      >
        <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {formatDist(totalDist)}
        </span>
        <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
          {formatTime(totalTime)}
        </span>
      </div>

      {/* Maneuver steps */}
      <div className="flex flex-col max-h-[50vh] overflow-y-auto">
        {allManeuvers.map((man, i) => (
          <button
            key={i}
            onClick={() => {
              if (man.begin_shape_index != null && onManeuverClick) onManeuverClick(man)
            }}
            className="flex items-start gap-2 px-2 py-2 text-left rounded transition-colors duration-75"
            style={{ '--hover-bg': 'var(--bg-overlay)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <span className="w-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>
              <ManeuverIcon type={man.type} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
                {man.instruction || man.verbal_pre_transition_instruction || 'Continue'}
              </p>
              <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {formatDist(man.length || 0)}
                {man.timeRemaining > 0 && (
                  <span className="ml-2">{formatTime(man.timeRemaining)} left</span>
                )}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
