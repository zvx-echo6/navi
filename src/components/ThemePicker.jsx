import { useState, useRef, useEffect } from 'react'
import { Palette } from 'lucide-react'
import { themeList } from '../themes/registry'
import { useStore } from '../store'

/**
 * ThemeSwatch - Renders a circular swatch with 3 color segments
 */
function ThemeSwatch({ colors, size = 28, active = false }) {
  // Split circle into 3 segments using conic gradient
  const gradient = `conic-gradient(
    ${colors[0]} 0deg 120deg,
    ${colors[1]} 120deg 240deg,
    ${colors[2]} 240deg 360deg
  )`

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient,
        border: active ? '2px solid var(--accent)' : '2px solid var(--border)',
        boxShadow: active ? '0 0 0 2px var(--accent-muted)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    />
  )
}

/**
 * ThemePicker - Popover component for selecting themes
 */
export default function ThemePicker() {
  const [isOpen, setIsOpen] = useState(false)
  const theme = useStore((s) => s.theme)
  const setThemeOverride = useStore((s) => s.setThemeOverride)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const themes = themeList()
  const currentTheme = themes.find(t => t.id === theme) || themes[0]

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }

    function handleEscape(e) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleThemeSelect = (themeId) => {
    setThemeOverride(themeId)
    setIsOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded flex items-center justify-center"
        style={{ color: 'var(--text-secondary)' }}
        aria-label="Select theme"
        title="Select theme"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Palette size={16} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '12px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100,
            minWidth: '140px',
          }}
          role="menu"
          aria-orientation="horizontal"
        >
          <div
            style={{
              display: 'flex',
              gap: '16px',
              justifyContent: 'center',
            }}
          >
            {themes.map((t) => (
              <button
                key={t.id}
                onClick={() => handleThemeSelect(t.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'transparent',
                  border: 'none',
                  padding: '4px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-overlay)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
                role="menuitem"
                aria-current={t.id === theme ? 'true' : undefined}
              >
                <ThemeSwatch
                  colors={t.swatch}
                  size={32}
                  active={t.id === theme}
                />
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: t.id === theme ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: t.id === theme ? 500 : 400,
                  }}
                >
                  {t.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
