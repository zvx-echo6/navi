import {
  MoveRight, MoveUpRight, MoveDownRight, CornerUpRight, CornerUpLeft,
  MoveLeft, MoveUpLeft, MoveDownLeft, CircleDot, RotateCw,
  GitMerge, CornerRightDown, CornerRightUp, Navigation, Mountain, Map, AlertTriangle
} from 'lucide-react'
import { useStore } from '../store'

function formatDistKm(km) {
  const miles = km * 0.621371
  if (miles < 0.1) return Math.round(miles * 5280) + ' ft'
  return miles.toFixed(1) + ' mi'
}

function formatTimeMin(minutes) {
  if (minutes < 60) return Math.round(minutes) + ' min'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? h + 'h ' + m + 'm' : h + 'h'
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

export default function ManeuverList() {
  const routeResult = useStore((s) => s.routeResult)
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

  if (!routeResult?.summary) return null

  const summary = routeResult.summary
  const networkFeature = routeResult.route?.features?.find(f => f.properties?.segment_type === 'network')
  const maneuvers = networkFeature?.properties?.maneuvers || []

  return (
    <div className="flex flex-col">
      {/* Total summary */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded mb-2"
        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
      >
        <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {formatDistKm(summary.total_distance_km)}
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
              {formatDistKm(summary.wilderness_distance_km)} / {formatTimeMin(summary.wilderness_effort_minutes)}
            </span>
          </div>
        )}
        {summary.network_distance_km > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Map size={14} style={{ color: '#3b82f6' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Road/Trail</span>
            <span className="ml-auto font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {formatDistKm(summary.network_distance_km)} / {formatTimeMin(summary.network_duration_minutes)}
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
      {maneuvers.length > 0 && (
        <div className="flex flex-col max-h-[40vh] overflow-y-auto">
          <div className="text-xs px-2 mb-1" style={{ color: 'var(--text-tertiary)' }}>Directions</div>
          {maneuvers.map((man, i) => (
            <div
              key={i}
              className="flex items-start gap-2 px-2 py-2 text-left"
            >
              <span className="w-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>
                <ManeuverIcon type={man.type} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {man.instruction}
                </p>
                <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {formatDistKm(man.distance_km)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
