import {
  MoveRight, MoveUpRight, MoveDownRight, CornerUpRight, CornerUpLeft,
  MoveLeft, MoveUpLeft, MoveDownLeft, CircleDot, RotateCw,
  GitMerge, CornerRightDown, CornerRightUp, Navigation, Mountain, Map, AlertTriangle,
  Compass, ArrowUp, ArrowUpRight, ArrowRight, ArrowDownRight, ArrowDown,
  ArrowDownLeft, ArrowLeft, ArrowUpLeft, MapPin
} from 'lucide-react'
import { useStore } from '../store'

/**
 * Format distance with commas for feet, one decimal for miles.
 * Under 1 mile: "2,640 ft"
 * 1+ miles: "1.3 mi"
 */
function formatDistance(distanceM, distanceKm) {
  let meters = null
  if (distanceM !== undefined && distanceM !== null) {
    meters = distanceM
  } else if (distanceKm !== undefined && distanceKm !== null) {
    meters = distanceKm * 1000
  }

  if (meters === null) return ''

  const miles = meters / 1609.34
  if (miles < 1) {
    const feet = Math.round(meters * 3.28084)
    return feet.toLocaleString() + ' ft'
  }
  return miles.toFixed(1) + ' mi'
}

function formatTimeMin(minutes) {
  if (minutes < 60) return Math.round(minutes) + ' min'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? h + 'h ' + m + 'm' : h + 'h'
}

// Compass arrow icon based on cardinal direction with rotation
function CompassIcon({ cardinal, bearing, size = 16 }) {
  // Use bearing to rotate arrow, or fall back to cardinal-based icon
  if (bearing !== undefined && bearing !== null) {
    return (
      <ArrowUp
        size={size}
        strokeWidth={2}
        style={{ transform: `rotate(${bearing}deg)` }}
      />
    )
  }

  const props = { size, strokeWidth: 2 }
  const arrowMap = {
    'N': ArrowUp,
    'NNE': ArrowUpRight,
    'NE': ArrowUpRight,
    'ENE': ArrowRight,
    'E': ArrowRight,
    'ESE': ArrowRight,
    'SE': ArrowDownRight,
    'SSE': ArrowDownRight,
    'S': ArrowDown,
    'SSW': ArrowDownLeft,
    'SW': ArrowDownLeft,
    'WSW': ArrowLeft,
    'W': ArrowLeft,
    'WNW': ArrowLeft,
    'NW': ArrowUpLeft,
    'NNW': ArrowUpLeft,
  }
  const Icon = arrowMap[cardinal] || Compass
  return <Icon {...props} />
}

// Wilderness maneuver icon
function WildernessIcon({ type, cardinal, bearing, size = 16 }) {
  if (type === 'arrival') {
    return <MapPin size={size} strokeWidth={1.5} />
  }
  return <CompassIcon cardinal={cardinal} bearing={bearing} size={size} />
}

// Network maneuver icon (Valhalla types)
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

/**
 * Add transport mode prefix to network maneuver instruction.
 * "Drive east on..." for auto, "Walk south on..." for foot, "Ride north on..." for 2w
 */
function formatNetworkInstruction(instruction, mode) {
  if (!instruction) return ''

  // Get verb based on mode
  const modeVerbs = {
    'auto': 'Drive',
    'foot': 'Walk',
    'pedestrian': 'Walk',
    '2w': 'Ride',
    'bicycle': 'Ride',
    '4w': 'Drive',
    'vehicle': 'Drive',
  }
  const verb = modeVerbs[mode] || 'Go'

  // Check if instruction starts with a direction verb we should replace
  const startsWithVerbs = [
    'Turn left', 'Turn right', 'Bear left', 'Bear right',
    'Keep left', 'Keep right', 'Continue', 'Head', 'Go',
    'Proceed', 'Make a', 'Take a', 'Start', 'Merge', 'Exit'
  ]

  for (const v of startsWithVerbs) {
    if (instruction.startsWith(v)) {
      // Already has a verb, return as-is (Valhalla instructions are already good)
      return instruction
    }
  }

  // If instruction starts with direction (north, south, etc.), prepend verb
  const directions = ['north', 'south', 'east', 'west', 'onto', 'on ']
  for (const dir of directions) {
    if (instruction.toLowerCase().startsWith(dir)) {
      return `${verb} ${instruction}`
    }
  }

  return instruction
}

export default function ManeuverList() {
  const routeResult = useStore((s) => s.routeResult)
  const routeLoading = useStore((s) => s.routeLoading)
  const routeError = useStore((s) => s.routeError)
  const routeMode = useStore((s) => s.routeMode)

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

  if (!routeResult?.summary) return null

  const summary = routeResult.summary
  const features = routeResult.route?.features || []
  const networkMode = summary.network_mode || routeMode || 'foot'

  // Extract maneuvers from each segment type
  const wildernessStartFeature = features.find(f =>
    f.properties?.segment_type === 'wilderness' && f.properties?.segment_position === 'start'
  )
  const networkFeature = features.find(f => f.properties?.segment_type === 'network')
  const wildernessEndFeature = features.find(f =>
    f.properties?.segment_type === 'wilderness' && f.properties?.segment_position === 'end'
  )

  const wildernessStartManeuvers = wildernessStartFeature?.properties?.maneuvers || []
  const networkManeuvers = networkFeature?.properties?.maneuvers || []
  const wildernessEndManeuvers = wildernessEndFeature?.properties?.maneuvers || []

  const hasManeuvers = wildernessStartManeuvers.length > 0 ||
                       networkManeuvers.length > 0 ||
                       wildernessEndManeuvers.length > 0

  return (
    <div className="flex flex-col">
      {/* Total summary */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded mb-2"
        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
      >
        <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {formatDistance(null, summary.total_distance_km)}
        </span>
        <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
          {formatTimeMin(summary.total_effort_minutes)}
        </span>
      </div>

      {/* Segment breakdown */}
      <div className="flex flex-col gap-1 px-2 mb-2">
        {summary.wilderness_distance_km > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Mountain size={14} style={{ color: '#f97316' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Wilderness</span>
            <span className="ml-auto font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {formatDistance(null, summary.wilderness_distance_km)} / {formatTimeMin(summary.wilderness_effort_minutes)}
            </span>
          </div>
        )}
        {summary.network_distance_km > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Map size={14} style={{ color: '#3b82f6' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Road/Trail</span>
            <span className="ml-auto font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {formatDistance(null, summary.network_distance_km)} / {formatTimeMin(summary.network_duration_minutes)}
            </span>
          </div>
        )}
      </div>

      {/* Warnings */}
      {(summary.barrier_crossings > 0 || summary.mvum_closed_crossings > 0) && (
        <div className="px-2 mb-2 flex flex-col gap-1">
          {summary.barrier_crossings > 0 && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--status-warning)' }}>
              <AlertTriangle size={12} />
              <span>{summary.barrier_crossings} barrier crossing{summary.barrier_crossings > 1 ? 's' : ''}</span>
            </div>
          )}
          {summary.mvum_closed_crossings > 0 && (
            <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--status-warning)' }}>
              <AlertTriangle size={12} />
              <span>{summary.mvum_closed_crossings} MVUM closure{summary.mvum_closed_crossings > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Turn-by-turn directions */}
      {hasManeuvers && (
        <div className="flex flex-col max-h-[40vh] overflow-y-auto">
          <div className="text-xs px-2 mb-1" style={{ color: 'var(--text-tertiary)' }}>Directions</div>

          {/* Wilderness start maneuvers */}
          {wildernessStartManeuvers.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wide px-2 py-1 font-medium"
                   style={{ color: '#f97316', background: 'rgba(249,115,22,0.1)' }}>
                Wilderness — On Foot
              </div>
              {wildernessStartManeuvers.map((man, i) => (
                <div key={`ws-${i}`} className="flex items-start gap-2 px-2 py-2 text-left">
                  <span className="w-5 shrink-0 mt-0.5" style={{ color: '#f97316' }}>
                    <WildernessIcon type={man.type} cardinal={man.cardinal} bearing={man.bearing} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {man.instruction}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Network maneuvers */}
          {networkManeuvers.length > 0 && (
            <>
              {wildernessStartManeuvers.length > 0 && (
                <div className="text-[10px] uppercase tracking-wide px-2 py-1 font-medium"
                     style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.1)' }}>
                  Road/Trail
                </div>
              )}
              {networkManeuvers.map((man, i) => (
                <div key={`net-${i}`} className="flex items-start gap-2 px-2 py-2 text-left">
                  <span className="w-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>
                    <ManeuverIcon type={man.type} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {formatNetworkInstruction(man.instruction, networkMode)}
                    </p>
                    <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDistance(null, man.distance_km)}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Wilderness end maneuvers */}
          {wildernessEndManeuvers.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wide px-2 py-1 font-medium"
                   style={{ color: '#f97316', background: 'rgba(249,115,22,0.1)' }}>
                Wilderness — On Foot
              </div>
              {wildernessEndManeuvers.map((man, i) => (
                <div key={`we-${i}`} className="flex items-start gap-2 px-2 py-2 text-left">
                  <span className="w-5 shrink-0 mt-0.5" style={{ color: '#f97316' }}>
                    <WildernessIcon type={man.type} cardinal={man.cardinal} bearing={man.bearing} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {man.instruction}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
