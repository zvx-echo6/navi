import { useStore } from '../store'

/** Format seconds into human-friendly string */
function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Format distance in miles */
function formatDist(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}

/** Get a maneuver type icon */
function maneuverIcon(type) {
  switch (type) {
    case 0: return '→' // straight
    case 1: return '↗' // slight right
    case 2: return '→' // right
    case 3: return '↘' // sharp right
    case 4: return '↩' // u-turn right
    case 5: return '↩' // u-turn left
    case 6: return '↙' // sharp left
    case 7: return '←' // left
    case 8: return '↖' // slight left
    case 9: return '●' // depart
    case 10: return '●' // arrive (straight)
    case 11: return '●' // arrive (right)
    case 12: return '●' // arrive (left)
    case 15: return '◎' // roundabout enter
    case 16: return '◎' // roundabout exit
    case 24: return '▲' // merge
    case 25: return '⤴' // on ramp
    case 26: return '⤵' // off ramp
    default: return '→'
  }
}

export default function ManeuverList({ onManeuverClick }) {
  const route = useStore((s) => s.route)
  const routeLoading = useStore((s) => s.routeLoading)
  const routeError = useStore((s) => s.routeError)

  if (routeLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-sm text-gray-400">Calculating route...</span>
      </div>
    )
  }

  if (routeError) {
    return (
      <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
        {routeError}
      </div>
    )
  }

  if (!route || !route.legs) return null

  // Compute total summary
  const totalTime = route.summary?.time || 0
  const totalDist = route.summary?.length || 0

  // Flatten all maneuvers with cumulative time remaining
  const allManeuvers = []
  let timeRemaining = totalTime

  for (let legIdx = 0; legIdx < route.legs.length; legIdx++) {
    const leg = route.legs[legIdx]
    for (const man of leg.maneuvers || []) {
      allManeuvers.push({
        ...man,
        _legIndex: legIdx,
        timeRemaining,
      })
      timeRemaining -= man.time || 0
    }
  }

  return (
    <div className="flex flex-col">
      {/* Route summary */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/60 rounded mb-2">
        <span className="text-sm font-medium text-white">
          {formatDist(totalDist)}
        </span>
        <span className="text-sm text-gray-300">
          {formatTime(totalTime)}
        </span>
      </div>

      {/* Maneuver steps */}
      <div className="flex flex-col divide-y divide-gray-700 max-h-[50vh] overflow-y-auto">
        {allManeuvers.map((man, i) => (
          <button
            key={i}
            onClick={() => {
              if (man.begin_shape_index != null && onManeuverClick) {
                onManeuverClick(man)
              }
            }}
            className="flex items-start gap-2 px-2 py-2 text-left hover:bg-gray-800/60 transition-colors"
          >
            <span className="text-base w-6 text-center shrink-0 text-cyan-400">
              {maneuverIcon(man.type)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 leading-tight">
                {man.instruction || man.verbal_pre_transition_instruction || 'Continue'}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {formatDist(man.length || 0)}
                {man.timeRemaining > 0 && (
                  <span className="ml-2">{formatTime(man.timeRemaining)} remaining</span>
                )}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
