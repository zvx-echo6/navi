/**
 * Theme Registry for Navi
 *
 * Provides a centralized registry for map themes, supporting both built-in
 * protomaps themes (light/dark) and custom themes with full flavor objects.
 *
 * Theme config structure:
 *   id: string           - unique identifier (used in store, data-theme attr)
 *   name: string         - display name for UI
 *   dark: boolean        - true if dark theme (affects overlay styling, sprite fallback)
 *   colors: object|null  - null for built-in themes, full flavor object for custom
 *   satellite: object|null - raster adjustments when satellite layer is present
 *   overlay: object      - overlay layer styling configuration
 *   ui: object           - CSS custom properties for UI elements
 *   swatch: string[3]    - 3 hex colors for theme picker preview
 *   fontImports: string[] - URLs for font CSS imports (empty for system fonts)
 */

import { namedTheme } from 'protomaps-themes-base'
import cleanTheme from './clean.js'
import cyberpunkTheme from './cyberpunk.js'

// ═══════════════════════════════════════════════════════════════════════════
// UI CSS CUSTOM PROPERTIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dark theme UI configuration
 * All CSS custom properties for dark theme UI
 */
const darkUI = {
  // Fonts
  '--font-sans': "'Inter', system-ui, -apple-system, sans-serif",
  '--font-mono': "'JetBrains Mono', ui-monospace, monospace",
  '--font-heading': "'Inter', system-ui, -apple-system, sans-serif",
  // Backgrounds
  '--bg-base': '#1c1917',
  '--bg-raised': '#252220',
  '--bg-overlay': '#2e2a27',
  '--bg-input': '#201d1a',
  '--bg-inset': '#181614',
  '--bg-muted': '#2a2725',
  // Text
  '--text-primary': '#dde3dc',
  '--text-secondary': '#8f9a8e',
  '--text-tertiary': '#5e6b5d',
  '--text-inverse': '#1c1917',
  // Borders
  '--border': '#3a3530',
  '--border-subtle': '#2a2624',
  // Accent
  '--accent': '#7a9a6b',
  '--accent-hover': '#8fad7f',
  '--accent-muted': '#3d4d36',
  // Tan
  '--tan': '#b8a88a',
  '--tan-muted': '#4a4235',
  // Pins
  '--pin-origin': '#6b8f5e',
  '--pin-destination': '#a67c52',
  '--pin-intermediate': '#6b7268',
  '--pin-stroke': '#1c1917',
  // Status
  '--status-success': '#6b8f5e',
  '--status-warning': '#b89a4a',
  '--status-danger': '#a65c52',
  '--success': '#6b8f5e',
  '--warning': '#b89a4a',
  '--warning-muted': '#4a4235',
  // Route
  '--route-line': '#7a9a6b',
  // Shadows
  '--shadow': '0 2px 8px rgba(0, 0, 0, 0.4)',
  '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.5)',
}

/**
 * Light theme UI configuration
 * All CSS custom properties for light theme UI
 */
const lightUI = {
  // Fonts
  '--font-sans': "'Inter', system-ui, -apple-system, sans-serif",
  '--font-mono': "'JetBrains Mono', ui-monospace, monospace",
  '--font-heading': "'Inter', system-ui, -apple-system, sans-serif",
  // Backgrounds
  '--bg-base': '#ddd2b9',
  '--bg-raised': '#e8dec8',
  '--bg-overlay': '#e3d9c1',
  '--bg-input': '#e8dec8',
  '--bg-inset': '#d5cab2',
  '--bg-muted': '#e0d6c0',
  // Text
  '--text-primary': '#1a1d1a',
  '--text-secondary': '#4f5a49',
  '--text-tertiary': '#7a8674',
  '--text-inverse': '#f5f2ed',
  // Borders
  '--border': '#c4b89e',
  '--border-subtle': '#d5cab2',
  // Accent
  '--accent': '#4a7040',
  '--accent-hover': '#3d5e35',
  '--accent-muted': '#dce8d6',
  // Tan
  '--tan': '#8a7556',
  '--tan-muted': '#f0e8d8',
  // Pins
  '--pin-origin': '#4a7040',
  '--pin-destination': '#8a5c35',
  '--pin-intermediate': '#6b6960',
  '--pin-stroke': '#1a1d1a',
  // Status
  '--status-success': '#4a7040',
  '--status-warning': '#8a7040',
  '--status-danger': '#8a4040',
  '--success': '#4a7040',
  '--warning': '#8a7040',
  '--warning-muted': '#f0e8d8',
  // Route
  '--route-line': '#4a7040',
  // Shadows
  '--shadow': '0 2px 8px rgba(0, 0, 0, 0.08)',
  '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.12)',
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERLAY CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dark theme overlay configuration
 * All hardcoded values from overlay add functions extracted here
 */
const darkOverlay = {
  // ── Hillshade ─────────────────────────────────────────────────────────────
  hillshade: {
    exaggeration: 0.5,
    illuminationDirection: 315,
    shadowColor: '#000000',
    highlightColor: '#ffffff',
  },

  // ── Traffic ───────────────────────────────────────────────────────────────
  traffic: {
    opacity: 0.6,
  },

  // ── Contours (main, brown/tan scheme) ─────────────────────────────────────
  contours: {
    opacityMod: 0.8,
    minorColor: '#8b6f47',
    minorOpacity: 0.4,
    minorWidth: { z11: 0.5, z14: 1.0 },
    intermediateColor: '#8b6f47',
    intermediateOpacity: 0.7,
    intermediateWidth: { z8: 0.8, z14: 1.2 },
    indexColor: '#6b4f2a',
    indexOpacity: 0.9,
    indexWidth: { z4: 1.2, z14: 1.8 },
    labelColor: '#c0b898',
    labelHaloColor: '#1a1a1a',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 10,
    labelFont: ['Noto Sans Regular'],
  },

  // ── Contours Test (blue scheme) ───────────────────────────────────────────
  // Missing keys cascade from contours
  contoursTest: {
    minorColor: '#4a7c9b',
    intermediateColor: '#4a7c9b',
    indexColor: '#2a5a7c',
    labelColor: '#98b8d0',
  },

  // ── Contours Test 10ft (green scheme) ─────────────────────────────────────
  // Missing keys cascade from contours
  contoursTest10ft: {
    minorColor: '#3a7c4f',
    intermediateColor: '#3a7c4f',
    indexColor: '#2a5c3a',
    labelColor: '#98c0a8',
  },

  // ── Public Lands (PAD-US) ─────────────────────────────────────────────────
  publicLands: {
    opacityMod: 0.7,
    // Fill colors per category
    fillWA: '#7c6b2f',
    fillNPS: '#3d6b1f',
    fillUSFS: '#5a7c2f',
    fillBLM: '#c4a672',
    fillFWS: '#4a7a5a',
    fillSTAT: '#5a8c7c',
    fillLOC: '#8ca694',
    fillDefault: '#a0a0a0',
    // Fill base opacities (multiplied by opacityMod)
    fillOpacityWA: 0.30,
    fillOpacityNPS: 0.30,
    fillOpacityUSFS: 0.25,
    fillOpacityBLM: 0.20,
    fillOpacitySTAT: 0.25,
    fillOpacityLOC: 0.20,
    fillOpacityDefault: 0.15,
    // Outline colors per category
    outlineWA: '#5a4d20',
    outlineNPS: '#2a4a15',
    outlineUSFS: '#3d5520',
    outlineBLM: '#8a7343',
    outlineFWS: '#2d5a3a',
    outlineSTAT: '#3d6055',
    outlineLOC: '#5c6e66',
    outlineDefault: '#707070',
    // Outline opacities
    outlineOpacityNPS: 0.7,
    outlineOpacityUSFS: 0.6,
    outlineOpacityDefault: 0.5,
    // Outline width
    outlineWidth: { z4: 0.3, z8: 0.8, z12: 1.2 },
    // Labels
    labelColor: '#c0c8b8',
    labelHaloColor: '#1a1a1a',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: { z10: 10, z14: 13 },
    labelFont: ['Noto Sans Regular'],
  },

  // ── USFS Trails ───────────────────────────────────────────────────────────
  usfsTrails: {
    // Roads
    roadsColor: '#d0a060',
    roadsOpacity: 0.9,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    // Trails colors by use type
    trailsMotorized: '#f08040',
    trailsBicycle: '#e0b040',
    trailsHiker: '#60c050',
    trailsDefault: '#c0a060',
    trailsOpacity: 0.9,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    // Road labels
    roadsLabelColor: '#d0c0a0',
    roadsLabelHaloColor: '#1a1a1a',
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.9,
    roadsLabelSize: 11,
    // Trail labels
    trailsLabelColor: '#d0b090',
    trailsLabelHaloColor: '#1a1a1a',
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.9,
    trailsLabelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },

  // ── BLM Trails / Roads ────────────────────────────────────────────────────
  blmTrails: {
    // Route colors by use class
    color4wdHigh: '#f08040',
    color4wdLow: '#e0b040',
    colorAtv: '#e04040',
    colorMotoSingle: '#b070c0',
    color2wdLow: '#f0d070',
    colorNonMech: '#60c050',
    colorDefault: '#c0a060',
    colorSnow: '#80b0e0',
    lineOpacity: 0.9,
    lineOpacityOther: 0.85,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    // Dash patterns by surface type
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    // Labels
    labelColor: '#d0c0a0',
    labelHaloColor: '#1a1a1a',
    labelHaloWidth: 1.5,
    labelOpacity: 0.9,
    labelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },

  // ── Highlight (boundary/selection) ────────────────────────────────────────
  highlight: {
    lineColor: "#7a9a6b",  // Muted olive-green for dark backgrounds
    lineWidth: 2,
    lineDash: [4, 4],
    lineOpacity: 0.8,
    fillColor: "#7a9a6b",
    fillOpacity: 0.08,
  },
}

/**
 * Light theme overlay configuration
 * All hardcoded values from overlay add functions extracted here
 */
const lightOverlay = {
  // ── Hillshade ─────────────────────────────────────────────────────────────
  hillshade: {
    exaggeration: 0.5,
    illuminationDirection: 315,
    shadowColor: '#000000',
    highlightColor: '#ffffff',
  },

  // ── Traffic ───────────────────────────────────────────────────────────────
  traffic: {
    opacity: 0.6,
  },

  // ── Contours (main, brown/tan scheme) ─────────────────────────────────────
  contours: {
    opacityMod: 1.0,
    minorColor: '#8b6f47',
    minorOpacity: 0.4,
    minorWidth: { z11: 0.5, z14: 1.0 },
    intermediateColor: '#8b6f47',
    intermediateOpacity: 0.7,
    intermediateWidth: { z8: 0.8, z14: 1.2 },
    indexColor: '#6b4f2a',
    indexOpacity: 0.9,
    indexWidth: { z4: 1.2, z14: 1.8 },
    labelColor: '#5a4020',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 10,
    labelFont: ['Noto Sans Regular'],
  },

  // ── Contours Test (blue scheme) ───────────────────────────────────────────
  // Missing keys cascade from contours
  contoursTest: {
    minorColor: '#4a7c9b',
    intermediateColor: '#4a7c9b',
    indexColor: '#2a5a7c',
    labelColor: '#205080',
  },

  // ── Contours Test 10ft (green scheme) ─────────────────────────────────────
  // Missing keys cascade from contours
  contoursTest10ft: {
    minorColor: '#3a7c4f',
    intermediateColor: '#3a7c4f',
    indexColor: '#2a5c3a',
    labelColor: '#2a4030',
  },

  // ── Public Lands (PAD-US) ─────────────────────────────────────────────────
  publicLands: {
    opacityMod: 1.0,
    // Fill colors per category
    fillWA: '#7c6b2f',
    fillNPS: '#3d6b1f',
    fillUSFS: '#5a7c2f',
    fillBLM: '#c4a672',
    fillFWS: '#4a7a5a',
    fillSTAT: '#5a8c7c',
    fillLOC: '#8ca694',
    fillDefault: '#a0a0a0',
    // Fill base opacities (multiplied by opacityMod)
    fillOpacityWA: 0.30,
    fillOpacityNPS: 0.30,
    fillOpacityUSFS: 0.25,
    fillOpacityBLM: 0.20,
    fillOpacitySTAT: 0.25,
    fillOpacityLOC: 0.20,
    fillOpacityDefault: 0.15,
    // Outline colors per category
    outlineWA: '#5a4d20',
    outlineNPS: '#2a4a15',
    outlineUSFS: '#3d5520',
    outlineBLM: '#8a7343',
    outlineFWS: '#2d5a3a',
    outlineSTAT: '#3d6055',
    outlineLOC: '#5c6e66',
    outlineDefault: '#707070',
    // Outline opacities
    outlineOpacityNPS: 0.7,
    outlineOpacityUSFS: 0.6,
    outlineOpacityDefault: 0.5,
    // Outline width
    outlineWidth: { z4: 0.3, z8: 0.8, z12: 1.2 },
    // Labels
    labelColor: '#3a4a30',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: { z10: 10, z14: 13 },
    labelFont: ['Noto Sans Regular'],
  },

  // ── USFS Trails ───────────────────────────────────────────────────────────
  usfsTrails: {
    // Roads
    roadsColor: '#c09050',
    roadsOpacity: 0.9,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    // Trails colors by use type
    trailsMotorized: '#e07030',
    trailsBicycle: '#d0a030',
    trailsHiker: '#50b040',
    trailsDefault: '#b09050',
    trailsOpacity: 0.9,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    // Road labels
    roadsLabelColor: '#6a5a40',
    roadsLabelHaloColor: '#ffffff',
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.9,
    roadsLabelSize: 11,
    // Trail labels
    trailsLabelColor: '#5a4a30',
    trailsLabelHaloColor: '#ffffff',
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.9,
    trailsLabelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },

  // ── BLM Trails / Roads ────────────────────────────────────────────────────
  blmTrails: {
    // Route colors by use class
    color4wdHigh: '#e07030',
    color4wdLow: '#d0a030',
    colorAtv: '#d03030',
    colorMotoSingle: '#a060b0',
    color2wdLow: '#e0c060',
    colorNonMech: '#50b040',
    colorDefault: '#b09050',
    colorSnow: '#6090c0',
    lineOpacity: 0.9,
    lineOpacityOther: 0.85,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    // Dash patterns by surface type
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    // Labels
    labelColor: '#5a4a30',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.9,
    labelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },

  // ── Highlight (boundary/selection) ────────────────────────────────────────
  highlight: {
    lineColor: "#4a7040",  // Forest green for light backgrounds
    lineWidth: 2,
    lineDash: [4, 4],
    lineOpacity: 0.7,
    fillColor: "#4a7040",
    fillOpacity: 0.06,
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// THEME REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

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
    overlay: lightOverlay,
    ui: lightUI,
    swatch: ['#ddd2b9', '#4a7040', '#8a7556'],
    fontImports: [],
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    dark: true,
    colors: null,  // Use namedTheme('dark')
    satellite: null,
    overlay: darkOverlay,
    ui: darkUI,
    swatch: ['#1c1917', '#7a9a6b', '#b8a88a'],
    fontImports: [],
  },
  clean: {
    ...cleanTheme,
    swatch: ['#f5f5f5', '#1a73e8', '#34a853'],
    fontImports: [],
  },
  cyberpunk: cyberpunkTheme,
  // Custom themes go here. Example:
  // 'midnight': {
  //   id: 'midnight',
  //   name: 'Midnight',
  //   dark: true,
  //   colors: { /* full flavor object matching dark-flavor-reference.json schema */ },
  //   satellite: { opacity: 0.8, brightnessMin: 0.1 },
  //   overlay: { /* partial overrides - missing keys fall back to dark overlay */ },
  //   ui: { /* partial overrides - missing keys fall back to dark ui */ },
  //   swatch: ['#0a0a12', '#6060ff', '#4040a0'],
  //   fontImports: ['https://fonts.googleapis.com/css2?family=Orbitron&display=swap'],
  // },
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

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
 * Get overlay configuration for a specific layer
 *
 * For contour variants (contoursTest, contoursTest10ft), missing keys cascade
 * from the same theme's contours config.
 *
 * For custom themes, missing keys fall back to the appropriate built-in theme
 * (dark or light based on theme.dark flag).
 *
 * @param {string} themeId - Theme ID
 * @param {string} layerKey - Overlay layer key (hillshade, contours, publicLands, etc.)
 * @returns {object} Merged overlay config for the layer
 */
export function getOverlayConfig(themeId, layerKey) {
  const theme = getTheme(themeId)
  const builtinTheme = theme.dark ? themes.dark : themes.light
  const builtinOverlay = builtinTheme.overlay[layerKey] || {}

  // For contour variants, cascade from same theme's contours config
  let baseConfig = builtinOverlay
  if (layerKey === 'contoursTest' || layerKey === 'contoursTest10ft') {
    const contoursBase = builtinTheme.overlay.contours || {}
    baseConfig = { ...contoursBase, ...builtinOverlay }
  }

  // If this is a custom theme with overlay overrides, merge them
  if (theme.overlay && theme.overlay[layerKey]) {
    // For contour variants in custom themes, also cascade from custom contours
    if (layerKey === 'contoursTest' || layerKey === 'contoursTest10ft') {
      const customContours = theme.overlay.contours || {}
      return { ...baseConfig, ...customContours, ...theme.overlay[layerKey] }
    }
    return { ...baseConfig, ...theme.overlay[layerKey] }
  }

  return baseConfig
}

/**
 * Apply theme UI CSS custom properties to the document
 *
 * Sets the data-theme attribute AND applies all CSS variables from the
 * theme's ui object directly to document.documentElement.style.
 *
 * Also manages font imports: removes previously injected font <link> tags
 * and injects new ones for the current theme's fontImports array.
 *
 * For custom themes, missing ui keys fall back to the appropriate built-in
 * theme (dark or light based on theme.dark flag).
 *
 * @param {object} theme - Theme config object (from getTheme())
 */
export function applyThemeUI(theme) {
  const root = document.documentElement

  // Set data-theme attribute for any CSS selectors that still reference it
  root.setAttribute('data-theme', theme.id)

  // Get base UI config from appropriate built-in theme
  const builtinTheme = theme.dark ? themes.dark : themes.light
  const baseUI = builtinTheme.ui

  // Merge with any custom theme overrides
  const ui = theme.ui ? { ...baseUI, ...theme.ui } : baseUI

  // Apply all UI variables directly to root element style
  for (const [prop, value] of Object.entries(ui)) {
    root.style.setProperty(prop, value)
  }

  // Manage font imports
  // Remove any previously injected theme font links
  document.querySelectorAll('link[data-theme-font]').forEach(link => link.remove())

  // Inject new font links for this theme
  const fontImports = theme.fontImports || []
  for (const url of fontImports) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.setAttribute('data-theme-font', theme.id)
    document.head.appendChild(link)
  }
}

/**
 * Get list of available themes for UI display
 * @returns {Array<{id: string, name: string, dark: boolean, swatch: string[]}>}
 */
export function themeList() {
  return Object.values(themes).map(({ id, name, dark, swatch }) => ({ id, name, dark, swatch }))
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
