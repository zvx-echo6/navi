import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'

/**
 * RadialMenu - ATAK-style radial context menu
 * Themed to match Navi light/dark palette using CSS custom properties.
 *
 * Props:
 * - open: boolean
 * - x, y: screen coordinates of trigger point
 * - lat, lon: geographic coordinates
 * - wedges: array of { id, label, icon: LucideIcon, onSelect, requiresAuth? }
 * - centerLabel: string (coords by default, replaced by reverse-geocode async)
 * - onDismiss: callback when menu should close
 */
export default function RadialMenu({
  open,
  x,
  y,
  lat,
  lon,
  wedges = [],
  centerLabel,
  onDismiss,
}) {
  const containerRef = useRef(null)
  const activeWedgeRef = useRef(null)
  const auth = useStore((s) => s.auth)
  const isAuthenticated = auth?.authenticated ?? false

  // Geometry constants
  const outerRadius = 80
  const innerRadius = 40
  const wedgeCount = wedges.length || 6
  const wedgeAngle = 360 / wedgeCount

  // Handle escape key
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onDismiss?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onDismiss])

  // Calculate which wedge the pointer is over
  const getWedgeAtPoint = useCallback((clientX, clientY) => {
    const dx = clientX - x
    const dy = clientY - y
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Inside inner radius = center (no wedge)
    if (dist < innerRadius) return null
    // Outside outer radius = no wedge
    if (dist > outerRadius + 20) return null

    // Calculate angle (0 = top, clockwise)
    let angle = Math.atan2(dx, -dy) * (180 / Math.PI)
    if (angle < 0) angle += 360

    // Find which wedge
    const wedgeIndex = Math.floor(angle / wedgeAngle)
    return wedges[wedgeIndex] || null
  }, [x, y, wedges, wedgeAngle])

  // Handle mouse/touch move for highlighting
  const handlePointerMove = useCallback((e) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    activeWedgeRef.current = getWedgeAtPoint(clientX, clientY)
    // Force re-render for highlight
    containerRef.current?.querySelectorAll('.radial-wedge').forEach((el, i) => {
      if (wedges[i] && wedges[i].id === activeWedgeRef.current?.id) {
        el.classList.add('active')
      } else {
        el.classList.remove('active')
      }
    })
  }, [getWedgeAtPoint, wedges])

  // Handle release
  const handlePointerUp = useCallback((e) => {
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY
    const wedge = getWedgeAtPoint(clientX, clientY)

    if (wedge) {
      wedge.onSelect?.({ lat, lon })
    }
    onDismiss?.()
  }, [getWedgeAtPoint, lat, lon, onDismiss])

  // Handle backdrop click (dismiss menu)
  const handleBackdropClick = useCallback((e) => {
    e.stopPropagation()
    onDismiss?.()
  }, [onDismiss])

  // Prevent menu container clicks from reaching backdrop
  const handleContainerClick = useCallback((e) => {
    e.stopPropagation()
  }, [])

  // Generate wedge paths
  const generateWedgePath = (index) => {
    const startAngle = (index * wedgeAngle - 90) * (Math.PI / 180)
    const endAngle = ((index + 1) * wedgeAngle - 90) * (Math.PI / 180)

    const x1 = innerRadius * Math.cos(startAngle)
    const y1 = innerRadius * Math.sin(startAngle)
    const x2 = outerRadius * Math.cos(startAngle)
    const y2 = outerRadius * Math.sin(startAngle)
    const x3 = outerRadius * Math.cos(endAngle)
    const y3 = outerRadius * Math.sin(endAngle)
    const x4 = innerRadius * Math.cos(endAngle)
    const y4 = innerRadius * Math.sin(endAngle)

    return `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z`
  }

  // Calculate icon position for each wedge
  const getIconPosition = (index) => {
    const midAngle = ((index + 0.5) * wedgeAngle - 90) * (Math.PI / 180)
    const r = (innerRadius + outerRadius) / 2
    return {
      x: r * Math.cos(midAngle),
      y: r * Math.sin(midAngle),
    }
  }

  if (!open) return null

  // Clamp position to viewport
  const padding = outerRadius + 20
  const clampedX = Math.max(padding, Math.min(window.innerWidth - padding, x))
  const clampedY = Math.max(padding, Math.min(window.innerHeight - padding, y))

  const content = (
    <>
      {/* Full-screen backdrop for dismiss — matches modal overlay opacity */}
      <div
        className="radial-backdrop"
        onClick={handleBackdropClick}
        onContextMenu={handleBackdropClick}
      />

      {/* Radial menu container */}
      <div
        ref={containerRef}
        className="radial-menu-container"
        onClick={handleContainerClick}
        style={{
          position: 'fixed',
          left: clampedX,
          top: clampedY,
          zIndex: 9999,
          transform: 'translate(-50%, -50%)',
          animation: 'radialFadeIn 100ms ease-out',
          filter: 'drop-shadow(var(--shadow-lg))',
        }}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      >
        <svg
          width={outerRadius * 2 + 40}
          height={outerRadius * 2 + 40}
          viewBox={`${-outerRadius - 20} ${-outerRadius - 20} ${outerRadius * 2 + 40} ${outerRadius * 2 + 40}`}
          style={{ overflow: 'visible' }}
        >
          {/* Wedges */}
          {wedges.map((wedge, i) => {
            const iconPos = getIconPosition(i)
            const Icon = wedge.icon
            // Only apply auth-required styling when requiresAuth AND user is NOT authenticated
            const needsAuth = wedge.requiresAuth && !isAuthenticated
            const wedgeClasses = `radial-wedge${needsAuth ? ' auth-required' : ''}`
            return (
              <g key={wedge.id} className={wedgeClasses} data-wedge-id={wedge.id}>
                <path
                  d={generateWedgePath(i)}
                  className="wedge-path"
                />
                <g transform={`translate(${iconPos.x}, ${iconPos.y})`}>
                  {Icon && (
                    <foreignObject
                      x={-9}
                      y={-12}
                      width={18}
                      height={18}
                      style={{ overflow: 'visible' }}
                    >
                      <Icon
                        size={18}
                        className="wedge-icon"
                        strokeWidth={1.5}
                      />
                    </foreignObject>
                  )}
                  <text
                    y={10}
                    textAnchor="middle"
                    className="wedge-label"
                  >
                    {wedge.label}
                  </text>
                </g>
              </g>
            )
          })}

          {/* Center disc */}
          <circle
            cx={0}
            cy={0}
            r={innerRadius - 2}
            className="center-disc"
          />
          <text
            y={-4}
            textAnchor="middle"
            className="center-coords"
          >
            {lat?.toFixed(4)}
          </text>
          <text
            y={8}
            textAnchor="middle"
            className="center-coords"
          >
            {lon?.toFixed(4)}
          </text>
          {centerLabel && (
            <text
              y={20}
              textAnchor="middle"
              className="center-label"
            >
              {centerLabel.length > 15 ? centerLabel.slice(0, 15) + '…' : centerLabel}
            </text>
          )}
        </svg>

        <style>{`
          /* Backdrop — matches modal overlay */
          .radial-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(0, 0, 0, 0.4);
            cursor: default;
          }

          /* Wedge paths — themed surface */
          .wedge-path {
            fill: var(--bg-overlay);
            fill-opacity: 0.92;
            stroke: var(--border);
            stroke-width: 1;
            transition: fill 100ms ease, fill-opacity 100ms ease;
          }

          .radial-wedge:hover .wedge-path {
            fill: var(--accent-muted);
            fill-opacity: 1;
          }

          .radial-wedge.active .wedge-path {
            fill: var(--accent-muted);
            fill-opacity: 1;
          }

          /* Wedge icons — secondary text color */
          .wedge-icon {
            color: var(--text-secondary);
            transition: color 100ms ease;
          }

          .radial-wedge:hover .wedge-icon,
          .radial-wedge.active .wedge-icon {
            color: var(--text-primary);
          }

          /* Wedge labels — secondary text */
          .wedge-label {
            font-family: var(--font-sans);
            font-size: 9px;
            fill: var(--text-secondary);
            pointer-events: none;
            transition: fill 100ms ease;
          }

          .radial-wedge:hover .wedge-label,
          .radial-wedge.active .wedge-label {
            fill: var(--text-primary);
          }

          /* Auth-required wedges — grayed out (only when NOT authenticated) */
          .radial-wedge.auth-required .wedge-icon {
            color: var(--text-tertiary);
          }

          .radial-wedge.auth-required .wedge-label {
            fill: var(--text-tertiary);
          }

          /* Auth-required wedges — suppress hover highlight (still clickable) */
          .radial-wedge.auth-required:hover .wedge-path,
          .radial-wedge.auth-required.active .wedge-path {
            fill: var(--bg-overlay);
            fill-opacity: 0.92;
          }

          /* Auth-required hover — content stays muted */
          .radial-wedge.auth-required:hover .wedge-icon,
          .radial-wedge.auth-required.active .wedge-icon {
            color: var(--text-tertiary);
          }

          .radial-wedge.auth-required:hover .wedge-label,
          .radial-wedge.auth-required.active .wedge-label {
            fill: var(--text-tertiary);
          }

          /* Center disc — raised surface */
          .center-disc {
            fill: var(--bg-raised);
            stroke: var(--border);
            stroke-width: 1;
          }

          /* Center coordinates — monospace primary */
          .center-coords {
            font-family: var(--font-mono);
            font-size: 10px;
            fill: var(--text-primary);
          }

          /* Center label — secondary italic */
          .center-label {
            font-family: var(--font-sans);
            font-size: 9px;
            font-style: italic;
            fill: var(--text-secondary);
          }

          @keyframes radialFadeIn {
            from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}</style>
      </div>
    </>
  )

  return createPortal(content, document.body)
}
