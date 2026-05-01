/**
 * Theme Registry for Navi
 * 
 * Provides a centralized registry for map themes, supporting both built-in
 * protomaps themes (light/dark) and custom themes with full flavor objects.
 * 
 * Theme config structure:
 *   id: string        - unique identifier (used in store, data-theme attr)
 *   name: string      - display name for UI
 *   dark: boolean     - true if dark theme (affects overlay styling, sprite fallback)
 *   colors: object|null - null for built-in themes, full flavor object for custom
 *   satellite: object|null - raster adjustments when satellite layer is present
 *   overlay: object|null   - reserved for future overlay-specific customizations
 */

import { namedTheme } from 'protomaps-themes-base'

/**
 * Theme registry - maps theme IDs to theme configurations
 * 
 * Built-in themes (light/dark) use colors: null to signal that namedTheme()
 * should be called at render time. Custom themes provide a full flavor object.
 */
const themes = {
  light: {
    id: 'light',
    name: 'Light',
    dark: false,
    colors: null,  // Use namedTheme('light')
    satellite: null,
    overlay: null,
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    dark: true,
    colors: null,  // Use namedTheme('dark')
    satellite: null,
    overlay: null,
  },
  // Custom themes go here. Example:
  // 'midnight': {
  //   id: 'midnight',
  //   name: 'Midnight',
  //   dark: true,
  //   colors: { /* full flavor object matching dark-flavor-reference.json schema */ },
  //   satellite: { opacity: 0.8, brightnessMin: 0.1 },
  //   overlay: null,
  // },
}

/**
 * Get a theme configuration by ID
 * @param {string} id - Theme ID
 * @returns {object} Theme config, falls back to 'dark' if not found
 */
export function getTheme(id) {
  return themes[id] || themes.dark
}

/**
 * Get the color flavor for a theme
 * For built-in themes, calls namedTheme(). For custom themes, returns colors directly.
 * @param {string} id - Theme ID
 * @returns {object} Flavor object for use with protomaps layers()
 */
export function getThemeColors(id) {
  const theme = getTheme(id)
  if (theme.colors === null) {
    // Built-in theme - use namedTheme from protomaps-themes-base
    return namedTheme(id)
  }
  return theme.colors
}

/**
 * Get the sprite URL for a theme
 * Built-in themes use their own sprites. Custom themes fall back to
 * dark or light sprite based on the theme's dark flag.
 * @param {string} id - Theme ID
 * @returns {string} Full sprite URL
 */
export function getThemeSprite(id) {
  const theme = getTheme(id)
  // Custom themes don't have matching sprites on CDN - fall back based on dark flag
  const spriteTheme = theme.colors === null ? id : (theme.dark ? 'dark' : 'light')
  return `https://protomaps.github.io/basemaps-assets/sprites/v4/${spriteTheme}`
}

/**
 * Get list of available themes for UI display
 * @returns {Array<{id: string, name: string, dark: boolean}>}
 */
export function themeList() {
  return Object.values(themes).map(({ id, name, dark }) => ({ id, name, dark }))
}

/**
 * Check if a theme ID is valid/registered
 * @param {string} id - Theme ID to check
 * @returns {boolean}
 */
export function isValidTheme(id) {
  return id in themes
}

export default themes
