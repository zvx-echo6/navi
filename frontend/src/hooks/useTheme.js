import { useEffect } from 'react'
import { useStore } from '../store'
import { getTheme, applyThemeUI } from '../themes/registry'

/**
 * Initializes and manages the theme system.
 * Call once in App — it handles:
 *  - Reading localStorage override on mount
 *  - Listening to system prefers-color-scheme
 *  - Applying theme UI via registry (CSS custom properties)
 *  - Updating store.theme (resolved value)
 */
export function useTheme() {
  const setTheme = useStore((s) => s.setTheme)
  const themeOverride = useStore((s) => s.themeOverride)

  // Initialize override from localStorage on first mount
  useEffect(() => {
    const stored = localStorage.getItem('navi-theme-override')
    if (stored) {
      const theme = getTheme(stored)
      if (theme) {
        useStore.getState().setThemeOverride(stored)
      }
    }
  }, [])

  // Resolve and apply theme
  useEffect(() => {
    function resolve() {
      if (themeOverride) return themeOverride
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    function apply() {
      const resolved = resolve()
      const theme = getTheme(resolved)
      applyThemeUI(theme)
      setTheme(resolved)
    }

    apply()

    // Listen for system changes (only matters when no override)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { if (!themeOverride) apply() }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeOverride, setTheme])
}
