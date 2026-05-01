/**
 * Clean Theme for Navi
 *
 * A plain, familiar, Google Maps-inspired style focused on maximum usability.
 * Clean, neutral, utilitarian. White/light gray land, soft pastel green parks,
 * gentle blue water, classic gray→yellow→orange road hierarchy. No strong
 * personality — everything serves readability and wayfinding.
 *
 * The theme equivalent of a rental car: nothing exciting, nothing wrong.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PALETTE
// ═══════════════════════════════════════════════════════════════════════════
//
// base: #f5f5f5          ← land, app background
// surface: #ffffff       ← panels, cards, modals
// surfaceAlt: #f8f9fa    ← secondary panels, hover states
// border: #dadce0        ← Google's standard border gray
// text: #202124          ← primary text (Google dark)
// textSecondary: #5f6368 ← secondary text
// textMuted: #9aa0a6     ← placeholders, hints
// accent: #1a73e8        ← Google blue — links, active states
// accentHover: #1557b0   ← darker blue hover
// success: #34a853       ← Google green
// warning: #fbbc04       ← Google yellow
// danger: #ea4335        ← Google red
// water: #aadaff         ← soft sky blue (Google's water)
// waterDark: #73b3e8     ← water labels
// vegetation: #c3ecb2    ← pastel green parks
// forest: #a8dda0        ← slightly deeper green
// road: #ffffff          ← minor roads — white
// roadPrimary: #fbc02d   ← yellow
// roadMotorway: #f9a825  ← deeper yellow-orange
// roadCasing: #e0e0e0    ← light gray casing
// building: #e8e4de      ← warm light gray
// contour: #c8b8a0       ← subtle warm brown
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const cleanColors = {
  // Background & earth
  background: '#e8e8e8',
  earth: '#f5f5f5',

  // Land use areas
  park_a: '#d4ecd0',
  park_b: '#c3ecb2',
  hospital: '#fde8e8',
  industrial: '#ebeff1',
  school: '#fff3e0',
  wood_a: '#d8ecd4',
  wood_b: '#a8dda0',
  pedestrian: '#f0f0f0',
  scrub_a: '#dcecd8',
  scrub_b: '#c8e4c0',
  glacier: '#f8fcff',
  sand: '#f5f0e0',
  beach: '#fef8e0',
  aerodrome: '#eaecef',
  runway: '#d0d0d0',
  water: '#aadaff',
  zoo: '#d8e8d8',
  military: '#e8e8e8',

  // Tunnels
  tunnel_other_casing: '#d8d8d8',
  tunnel_minor_casing: '#d8d8d8',
  tunnel_link_casing: '#d8d8d8',
  tunnel_major_casing: '#d8d8d8',
  tunnel_highway_casing: '#d8d8d8',
  tunnel_other: '#e8e8e8',
  tunnel_minor: '#e8e8e8',
  tunnel_link: '#f0e0a0',
  tunnel_major: '#f0e0a0',
  tunnel_highway: '#f0d080',

  // Pier & buildings
  pier: '#e0e0e0',
  buildings: '#e8e4de',

  // Roads & casings
  minor_service_casing: '#e0e0e0',
  minor_casing: '#e0e0e0',
  link_casing: '#d8c080',
  major_casing_late: '#d8c080',
  highway_casing_late: '#d8a860',
  other: '#f0f0f0',
  minor_service: '#ffffff',
  minor_a: '#ffffff',
  minor_b: '#ffffff',
  link: '#fbc02d',
  major_casing_early: '#d8c080',
  major: '#fbc02d',
  highway_casing_early: '#d8a860',
  highway: '#f9a825',
  railway: '#a0a0a0',
  boundaries: '#c0c0c0',

  // Waterway label
  waterway_label: '#73b3e8',

  // Bridges
  bridges_other_casing: '#d0d0d0',
  bridges_minor_casing: '#d0d0d0',
  bridges_link_casing: '#d8c080',
  bridges_major_casing: '#d8c080',
  bridges_highway_casing: '#d8a860',
  bridges_other: '#f0f0f0',
  bridges_minor: '#ffffff',
  bridges_link: '#fbc02d',
  bridges_major: '#fbc02d',
  bridges_highway: '#f9a825',

  // Labels
  roads_label_minor: '#5f6368',
  roads_label_minor_halo: '#ffffff',
  roads_label_major: '#5f6368',
  roads_label_major_halo: '#ffffff',
  ocean_label: '#73b3e8',
  peak_label: '#5f6368',
  subplace_label: '#5f6368',
  subplace_label_halo: '#ffffff',
  city_label: '#202124',
  city_label_halo: '#ffffff',
  state_label: '#9aa0a6',
  state_label_halo: '#ffffff',
  country_label: '#5f6368',
  address_label: '#5f6368',
  address_label_halo: '#ffffff',

  // POI icon colors
  pois: {
    blue: '#1a73e8',
    green: '#34a853',
    lapis: '#4285f4',
    pink: '#e91e63',
    red: '#ea4335',
    slategray: '#5f6368',
    tangerine: '#f9a825',
    turquoise: '#00bcd4',
  },

  // Landcover fill colors
  landcover: {
    grassland: 'rgba(200, 232, 192, 1)',
    barren: 'rgba(240, 235, 220, 1)',
    urban_area: 'rgba(235, 235, 235, 1)',
    farmland: 'rgba(216, 240, 210, 1)',
    glacier: 'rgba(250, 252, 255, 1)',
    scrub: 'rgba(220, 236, 216, 1)',
    forest: 'rgba(180, 224, 176, 1)',
  },
}

/**
 * UI CSS custom properties - app chrome styling
 * Clean Google-inspired white panels with standard gray text
 */
const cleanUI = {
  // Fonts
  '--font-sans': "'Inter', system-ui, -apple-system, sans-serif",
  '--font-mono': "'JetBrains Mono', ui-monospace, monospace",
  // Backgrounds
  '--bg-base': '#f5f5f5',
  '--bg-raised': '#ffffff',
  '--bg-overlay': '#ffffff',
  '--bg-input': '#ffffff',
  '--bg-inset': '#f0f0f0',
  '--bg-muted': '#f8f9fa',
  // Text
  '--text-primary': '#202124',
  '--text-secondary': '#5f6368',
  '--text-tertiary': '#9aa0a6',
  '--text-inverse': '#ffffff',
  // Borders
  '--border': '#dadce0',
  '--border-subtle': '#e8eaed',
  // Accent
  '--accent': '#1a73e8',
  '--accent-hover': '#1557b0',
  '--accent-muted': '#e8f0fe',
  // Tan
  '--tan': '#f9a825',
  '--tan-muted': '#fef7e0',
  // Pins
  '--pin-origin': '#34a853',
  '--pin-destination': '#ea4335',
  '--pin-intermediate': '#5f6368',
  '--pin-stroke': '#ffffff',
  // Status
  '--status-success': '#34a853',
  '--status-warning': '#fbbc04',
  '--status-danger': '#ea4335',
  '--success': '#34a853',
  '--warning': '#fbbc04',
  '--warning-muted': '#fef7e0',
  // Route
  '--route-line': '#1a73e8',
  // Shadows
  '--shadow': '0 1px 3px rgba(60, 64, 67, 0.15), 0 1px 2px rgba(60, 64, 67, 0.1)',
  '--shadow-lg': '0 2px 6px rgba(60, 64, 67, 0.2), 0 1px 3px rgba(60, 64, 67, 0.15)',
}

/**
 * Overlay configuration overrides
 * Light shadow hillshade, warm brown contours, standard public lands
 */
const cleanOverlay = {
  // Hillshade - light and natural
  hillshade: {
    exaggeration: 0.4,
    illuminationDirection: 315,
    shadowColor: '#000000',
    highlightColor: '#ffffff',
  },

  // Contours - warm brown, subtle
  contours: {
    opacityMod: 0.9,
    minorColor: '#c8b8a0',
    minorOpacity: 0.35,
    minorWidth: { z11: 0.5, z14: 0.8 },
    intermediateColor: '#c8b8a0',
    intermediateOpacity: 0.55,
    intermediateWidth: { z8: 0.7, z14: 1.0 },
    indexColor: '#a89878',
    indexOpacity: 0.75,
    indexWidth: { z4: 1.0, z14: 1.5 },
    labelColor: '#8a7a60',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: 10,
    labelFont: ['Noto Sans Regular'],
  },

  // Contours Test - blue variant
  contoursTest: {
    minorColor: '#5a9ab8',
    intermediateColor: '#5a9ab8',
    indexColor: '#3a7a98',
    labelColor: '#3a6a88',
  },

  // Contours Test 10ft - green variant
  contoursTest10ft: {
    minorColor: '#4a9a5f',
    intermediateColor: '#4a9a5f',
    indexColor: '#2a7a4a',
    labelColor: '#2a5a40',
  },

  // Public Lands - standard green tints with dark labels
  publicLands: {
    opacityMod: 0.9,
    // Fill colors per category
    fillWA: '#8a7a40',
    fillNPS: '#4a8030',
    fillUSFS: '#6a9040',
    fillBLM: '#d4b880',
    fillFWS: '#5a9068',
    fillSTAT: '#6aa088',
    fillLOC: '#9ab8a8',
    fillDefault: '#b0b0b0',
    // Fill opacities
    fillOpacityWA: 0.25,
    fillOpacityNPS: 0.25,
    fillOpacityUSFS: 0.20,
    fillOpacityBLM: 0.18,
    fillOpacitySTAT: 0.22,
    fillOpacityLOC: 0.18,
    fillOpacityDefault: 0.12,
    // Outline colors
    outlineWA: '#6a5a28',
    outlineNPS: '#2a5018',
    outlineUSFS: '#4a6828',
    outlineBLM: '#9a8050',
    outlineFWS: '#3a6848',
    outlineSTAT: '#4a7060',
    outlineLOC: '#6a8070',
    outlineDefault: '#808080',
    // Outline opacities
    outlineOpacityNPS: 0.65,
    outlineOpacityUSFS: 0.55,
    outlineOpacityDefault: 0.45,
    // Outline width
    outlineWidth: { z4: 0.3, z8: 0.8, z12: 1.2 },
    // Labels - dark for readability
    labelColor: '#2a3a28',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: { z10: 10, z14: 13 },
    labelFont: ['Noto Sans Regular'],
  },

  // USFS Trails - standard trail colors
  usfsTrails: {
    roadsColor: '#c09050',
    roadsOpacity: 0.85,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    trailsMotorized: '#e07030',
    trailsBicycle: '#d0a030',
    trailsHiker: '#50b040',
    trailsDefault: '#b09050',
    trailsOpacity: 0.85,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    roadsLabelColor: '#5a4a30',
    roadsLabelHaloColor: '#ffffff',
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.85,
    roadsLabelSize: 11,
    trailsLabelColor: '#4a3a28',
    trailsLabelHaloColor: '#ffffff',
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.85,
    trailsLabelSize: 11,
    labelFont: ['Noto Sans Regular'],
    hitWidth: 14,
  },

  // BLM Trails - standard route colors
  blmTrails: {
    color4wdHigh: '#e07030',
    color4wdLow: '#d0a030',
    colorAtv: '#d03030',
    colorMotoSingle: '#a060b0',
    color2wdLow: '#e0c060',
    colorNonMech: '#50b040',
    colorDefault: '#b09050',
    colorSnow: '#6090c0',
    lineOpacity: 0.85,
    lineOpacityOther: 0.80,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    labelColor: '#4a3a28',
    labelHaloColor: '#ffffff',
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 11,
    labelFont: ['Noto Sans Regular'],
    hitWidth: 14,
  },
}

/**
 * Clean theme configuration
 */
const cleanTheme = {
  id: 'clean',
  name: 'Clean',
  dark: false,
  colors: cleanColors,
  satellite: null,  // No adjustments — default clear view
  overlay: cleanOverlay,
  ui: cleanUI,
}

export default cleanTheme
