/**
 * Cyberpunk Theme for Navi
 *
 * Inspired by Mapbox's "Terminal" cyberpunk style, Blade Runner, and Ghost in
 * the Shell. A tactical display in a neon-lit command center. Near-black base
 * with deep blue-purple undertones. Roads glow in hot magenta and electric cyan.
 * Water is inky dark. Vegetation is barely there — dark teal hints. Labels are
 * cool white with colored halos.
 *
 * The whole thing should feel like you're navigating Night City.
 *
 * CUSTOM FONTS:
 * - Heading: "Orbitron" — geometric, futuristic display font
 * - Body: "Share Tech Mono" — monospaced terminal feel for entire UI
 */

// ═══════════════════════════════════════════════════════════════════════════
// PALETTE
// ═══════════════════════════════════════════════════════════════════════════
//
// base: #0a0a14         ← near-black with blue-purple undertone
// surface: #10101e      ← panels, cards
// surfaceAlt: #161628   ← secondary surfaces, hover states
// border: #1e1e3a       ← subtle purple edges
// text: #d0d0e8         ← cool white text
// textSecondary: #8888aa ← lavender-gray
// textMuted: #5a5a7a    ← dark purple-gray
// textInverse: #0a0a14  ← text on neon backgrounds
// accent: #ff2d6b       ← hot pink/magenta — primary actions
// accentHover: #ff4d8b  ← lighter magenta
// accentAlt: #00f0ff    ← electric cyan — secondary accent
// success: #00ff88      ← neon green
// warning: #ffaa00      ← amber
// danger: #ff3333       ← neon red
// water: #06061a        ← deep dark blue-black
// waterLabel: #3a6a8a   ← muted blue for water labels
// vegetation: #0a1a12   ← barely-there dark teal-green
// forest: #0e1e14       ← slightly deeper
// road: #1a1a3a         ← ghost purple minor roads
// roadSecondary: #2a2a5a
// roadPrimary: #8833aa  ← purple for primary
// roadMotorway: #ff2d6b ← hot magenta for motorways
// roadCasing: #0a0a14   ← dark casing
// building: #141428     ← dark purple-gray buildings
// contour: #1e1e3e      ← dark lines, just visible
// contourLabel: #5a5a7a
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const cyberpunkColors = {
  // Background & earth
  background: '#08080f',
  earth: '#0a0a14',

  // Land use areas - dark with slight purple undertones
  park_a: '#0a1a14',
  park_b: '#0e1e18',
  hospital: '#1a1020',
  industrial: '#0e0e1a',
  school: '#14101e',
  wood_a: '#0a1a12',
  wood_b: '#0e1e14',
  pedestrian: '#0c0c18',
  scrub_a: '#0a1410',
  scrub_b: '#0c1812',
  glacier: '#101020',
  sand: '#12101a',
  beach: '#14121c',
  aerodrome: '#0a0a16',
  runway: '#1a1a30',
  water: '#06061a',
  zoo: '#0c1614',
  military: '#100a14',

  // Tunnels - dark purple casings
  tunnel_other_casing: '#0a0a14',
  tunnel_minor_casing: '#0a0a14',
  tunnel_link_casing: '#0a0a14',
  tunnel_major_casing: '#0a0a14',
  tunnel_highway_casing: '#0a0a14',
  tunnel_other: '#161628',
  tunnel_minor: '#161628',
  tunnel_link: '#2a2050',
  tunnel_major: '#4a2870',
  tunnel_highway: '#801848',

  // Pier & buildings
  pier: '#1a1a30',
  buildings: '#141428',

  // Roads & casings - glowing neon progression
  minor_service_casing: '#0a0a14',
  minor_casing: '#0a0a14',
  link_casing: '#0a0a14',
  major_casing_late: '#0a0a14',
  highway_casing_late: '#0a0a14',
  other: '#1a1a3a',
  minor_service: '#1a1a3a',
  minor_a: '#2a2a5a',
  minor_b: '#1a1a3a',
  link: '#5a3888',
  major_casing_early: '#0a0a14',
  major: '#8833aa',
  highway_casing_early: '#0a0a14',
  highway: '#ff2d6b',
  railway: '#2a2050',
  boundaries: '#4a4a6a',

  // Waterway label
  waterway_label: '#3a6a8a',

  // Bridges - same neon colors
  bridges_other_casing: '#0c0c18',
  bridges_minor_casing: '#0a0a14',
  bridges_link_casing: '#0a0a14',
  bridges_major_casing: '#0a0a14',
  bridges_highway_casing: '#0a0a14',
  bridges_other: '#1a1a3a',
  bridges_minor: '#2a2a5a',
  bridges_link: '#5a3888',
  bridges_major: '#8833aa',
  bridges_highway: '#ff2d6b',

  // Labels - cool white with DARK halos
  roads_label_minor: '#8888aa',
  roads_label_minor_halo: '#0a0a14',
  roads_label_major: '#a0a0c0',
  roads_label_major_halo: '#0a0a14',
  ocean_label: '#3a6a8a',
  peak_label: '#8888aa',
  subplace_label: '#8888aa',
  subplace_label_halo: '#0a0a14',
  city_label: '#d0d0e8',
  city_label_halo: '#0a0a14',
  state_label: '#5a5a7a',
  state_label_halo: '#0a0a14',
  country_label: '#7a7a9a',
  address_label: '#8888aa',
  address_label_halo: '#0a0a14',

  // POI icon colors - neon palette
  pois: {
    blue: '#00a0ff',
    green: '#00ff88',
    lapis: '#6060ff',
    pink: '#ff2d6b',
    red: '#ff3333',
    slategray: '#8888aa',
    tangerine: '#ffaa00',
    turquoise: '#00f0ff',
  },

  // Landcover fill colors - very dark, barely visible
  landcover: {
    grassland: 'rgba(10, 26, 18, 1)',
    barren: 'rgba(18, 16, 26, 1)',
    urban_area: 'rgba(14, 14, 26, 1)',
    farmland: 'rgba(12, 24, 16, 1)',
    glacier: 'rgba(16, 16, 32, 1)',
    scrub: 'rgba(12, 20, 16, 1)',
    forest: 'rgba(14, 30, 20, 1)',
  },
}

/**
 * UI CSS custom properties - neon command center aesthetic
 * Dark translucent panels with magenta/cyan accents
 */
const cyberpunkUI = {
  // Fonts - monospace terminal feel
  '--font-sans': "'Share Tech Mono', monospace",
  '--font-mono': "'Share Tech Mono', monospace",
  '--font-heading': "'Orbitron', sans-serif",
  // Backgrounds - dark with blue-purple undertone
  '--bg-base': '#0a0a14',
  '--bg-raised': '#10101e',
  '--bg-overlay': '#161628',
  '--bg-input': '#0c0c18',
  '--bg-inset': '#08080f',
  '--bg-muted': '#12121e',
  // Text - cool white spectrum
  '--text-primary': '#d0d0e8',
  '--text-secondary': '#8888aa',
  '--text-tertiary': '#5a5a7a',
  '--text-inverse': '#0a0a14',
  // Borders - subtle purple edges
  '--border': '#1e1e3a',
  '--border-subtle': '#141428',
  // Accent - hot magenta
  '--accent': '#ff2d6b',
  '--accent-hover': '#ff4d8b',
  '--accent-muted': '#3a1828',
  // Tan becomes cyan in this theme
  '--tan': '#00f0ff',
  '--tan-muted': '#0a2830',
  // Pins - neon colors
  '--pin-origin': '#ff2d6b',
  '--pin-destination': '#00f0ff',
  '--pin-intermediate': '#8833aa',
  '--pin-stroke': '#0a0a14',
  // Status - neon signals
  '--status-success': '#00ff88',
  '--status-warning': '#ffaa00',
  '--status-danger': '#ff3333',
  '--success': '#00ff88',
  '--warning': '#ffaa00',
  '--warning-muted': '#2a2010',
  // Route - cyan for contrast with magenta UI
  '--route-line': '#00f0ff',
  // Shadows - subtle magenta glow
  '--shadow': '0 2px 8px rgba(255, 45, 107, 0.25)',
  '--shadow-lg': '0 4px 16px rgba(255, 45, 107, 0.35)',
}

/**
 * Overlay configuration - subtle, muted for dark theme
 */
const cyberpunkOverlay = {
  // Hillshade - dramatic shadows
  hillshade: {
    exaggeration: 0.6,
    illuminationDirection: 315,
    shadowColor: '#000000',
    highlightColor: '#2a2a4a',
  },

  // Contours - very subtle dark purple-gray
  contours: {
    opacityMod: 0.5,
    minorColor: '#1e1e3e',
    minorOpacity: 0.3,
    minorWidth: { z11: 0.4, z14: 0.8 },
    intermediateColor: '#2a2a4a',
    intermediateOpacity: 0.4,
    intermediateWidth: { z8: 0.6, z14: 1.0 },
    indexColor: '#3a3a5a',
    indexOpacity: 0.5,
    indexWidth: { z4: 0.8, z14: 1.2 },
    labelColor: '#5a5a7a',
    labelHaloColor: '#0a0a14',
    labelHaloWidth: 1.5,
    labelOpacity: 0.6,
    labelSize: 10,
    labelFont: ['Noto Sans Regular'],
  },

  // Contours Test - cyan variant
  contoursTest: {
    minorColor: '#1a3a4a',
    intermediateColor: '#2a4a5a',
    indexColor: '#3a5a6a',
    labelColor: '#5a8a9a',
  },

  // Contours Test 10ft - purple variant
  contoursTest10ft: {
    minorColor: '#2a1a4a',
    intermediateColor: '#3a2a5a',
    indexColor: '#4a3a6a',
    labelColor: '#7a6a9a',
  },

  // Public Lands - very muted fills
  publicLands: {
    opacityMod: 0.5,
    // Fill colors - dark teal/purple tints
    fillWA: '#1a2a20',
    fillNPS: '#0a2a1a',
    fillUSFS: '#102820',
    fillBLM: '#1a2828',
    fillFWS: '#0a2a2a',
    fillSTAT: '#102028',
    fillLOC: '#182028',
    fillDefault: '#1a1a2a',
    // Fill opacities - very low
    fillOpacityWA: 0.25,
    fillOpacityNPS: 0.25,
    fillOpacityUSFS: 0.20,
    fillOpacityBLM: 0.15,
    fillOpacitySTAT: 0.20,
    fillOpacityLOC: 0.15,
    fillOpacityDefault: 0.10,
    // Outline colors - subtle
    outlineWA: '#2a3a30',
    outlineNPS: '#1a3a2a',
    outlineUSFS: '#203830',
    outlineBLM: '#2a3838',
    outlineFWS: '#1a3a3a',
    outlineSTAT: '#203038',
    outlineLOC: '#283038',
    outlineDefault: '#2a2a3a',
    // Outline opacities
    outlineOpacityNPS: 0.5,
    outlineOpacityUSFS: 0.4,
    outlineOpacityDefault: 0.3,
    // Outline width
    outlineWidth: { z4: 0.3, z8: 0.6, z12: 1.0 },
    // Labels - muted teal
    labelColor: '#5a8a8a',
    labelHaloColor: '#0a0a14',
    labelHaloWidth: 1.5,
    labelOpacity: 0.7,
    labelSize: { z10: 10, z14: 12 },
    labelFont: ['Noto Sans Regular'],
  },

  // USFS Trails - purple/magenta/cyan family instead of earthy browns
  usfsTrails: {
    // Roads - purple
    roadsColor: '#8833aa',
    roadsOpacity: 0.85,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    // Trails - neon colors by use type
    trailsMotorized: '#ff2d6b',
    trailsBicycle: '#ffaa00',
    trailsHiker: '#00ff88',
    trailsDefault: '#8833aa',
    trailsOpacity: 0.85,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    // Road labels
    roadsLabelColor: '#a080c0',
    roadsLabelHaloColor: '#0a0a14',
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.85,
    roadsLabelSize: 11,
    // Trail labels
    trailsLabelColor: '#a080c0',
    trailsLabelHaloColor: '#0a0a14',
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.85,
    trailsLabelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },

  // BLM Trails - purple/cyan/magenta family
  blmTrails: {
    // Route colors - neon family
    color4wdHigh: '#ff2d6b',
    color4wdLow: '#cc2288',
    colorAtv: '#ff3333',
    colorMotoSingle: '#aa44cc',
    color2wdLow: '#8833aa',
    colorNonMech: '#00ff88',
    colorDefault: '#6644aa',
    colorSnow: '#00f0ff',
    lineOpacity: 0.85,
    lineOpacityOther: 0.75,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    // Dash patterns
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    // Labels
    labelColor: '#a080c0',
    labelHaloColor: '#0a0a14',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 11,
    labelFont: ['Noto Sans Regular'],
    // Hit layer
    hitWidth: 14,
  },
}

/**
 * Satellite adjustments - dark, desaturated, purple-shifted
 */
const cyberpunkSatellite = {
  opacity: 0.8,
  brightnessMin: 0.0,
  brightnessMax: 0.30,
  contrast: 0.15,
  saturation: -0.6,
  hueRotate: 280,
}

/**
 * Cyberpunk theme configuration
 */
const cyberpunkTheme = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  dark: true,
  swatch: ['#0a0a14', '#ff2d6b', '#00f0ff'],
  fontImports: [
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap',
  ],
  colors: cyberpunkColors,
  satellite: cyberpunkSatellite,
  overlay: cyberpunkOverlay,
  ui: cyberpunkUI,
}

export default cyberpunkTheme
