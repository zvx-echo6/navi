import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Lock } from 'lucide-react'

/**
 * RadialMenu - ATAK-style radial context menu
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

  // Handle click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onDismiss?.()
      }
    }
    // Delay to avoid triggering on the same click that opened the menu
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick)
    }, 50)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handleClick)
    }
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
    <div
      ref={containerRef}
      className="radial-menu-container"
      style={{
        position: 'fixed',
        left: clampedX,
        top: clampedY,
        zIndex: 9999,
        transform: 'translate(-50%, -50%)',
        animation: 'radialFadeIn 100ms ease-out',
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
          return (
            <g key={wedge.id} className="radial-wedge" data-wedge-id={wedge.id}>
              <path
                d={generateWedgePath(i)}
                fill="rgba(30, 28, 26, 0.85)"
                stroke="rgba(180, 160, 140, 0.3)"
                strokeWidth="1"
                style={{ transition: 'fill 100ms ease' }}
                className="wedge-path"
              />
              <g transform={`translate(${iconPos.x}, ${iconPos.y})`}>
                {Icon && (
                  <Icon
                    size={18}
                    stroke="rgba(230, 220, 210, 0.9)"
                    strokeWidth={1.5}
                    style={{ transform: 'translate(-9px, -12px)' }}
                  />
                )}
                {wedge.requiresAuth && (
                  <Lock
                    size={10}
                    stroke="rgba(230, 220, 210, 0.6)"
                    strokeWidth={1.5}
                    style={{ transform: 'translate(4px, -14px)' }}
                  />
                )}
                <text
                  y={10}
                  textAnchor="middle"
                  fontSize="9"
                  fill="rgba(230, 220, 210, 0.8)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
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
          fill="rgba(50, 45, 40, 0.95)"
          stroke="rgba(180, 160, 140, 0.4)"
          strokeWidth="1"
        />
        <text
          y={-4}
          textAnchor="middle"
          fontSize="10"
          fontFamily="monospace"
          fill="rgba(230, 220, 210, 0.9)"
        >
          {lat?.toFixed(4)}
        </text>
        <text
          y={8}
          textAnchor="middle"
          fontSize="10"
          fontFamily="monospace"
          fill="rgba(230, 220, 210, 0.9)"
        >
          {lon?.toFixed(4)}
        </text>
        {centerLabel && (
          <text
            y={20}
            textAnchor="middle"
            fontSize="9"
            fill="rgba(200, 180, 160, 0.9)"
            style={{ fontStyle: 'italic' }}
          >
            {centerLabel.length > 15 ? centerLabel.slice(0, 15) + '…' : centerLabel}
          </text>
        )}
      </svg>

      <style>{`
        .radial-wedge.active .wedge-path {
          fill: rgba(180, 160, 140, 0.4) !important;
        }
        .radial-wedge:hover .wedge-path {
          fill: rgba(180, 160, 140, 0.3);
        }
        @keyframes radialFadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </div>
  )

  return createPortal(content, document.body)
}
