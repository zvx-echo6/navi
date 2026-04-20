import { useEffect } from 'react'
import { useStore } from '../store'

/**
 * Initializes and manages the theme system.
 * Call once in App — it handles:
 *  - Reading localStorage override on mount
 *  - Listening to system prefers-color-scheme
 *  - Applying data-theme to <html>
 *  - Updating store.theme (resolved value)
 */
export function useTheme() {
  const setTheme = useStore((s) => s.setTheme)
  const themeOverride = useStore((s) => s.themeOverride)

  // Initialize override from localStorage on first mount
  useEffect(() => {
    const stored = localStorage.getItem('navi-theme-override')
    if (stored === 'dark' || stored === 'light') {
      useStore.getState().setThemeOverride(stored)
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
      document.documentElement.setAttribute('data-theme', resolved)
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
