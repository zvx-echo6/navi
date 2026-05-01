/**
 * Parchment Theme for Navi
 *
 * Medieval manuscript cartography. An ancient vellum map unrolled on a table —
 * deep rich ultramarine water (not modern pale blue), warm aged parchment land,
 * dark sepia ink labels, burnt sienna roads. Forests are olive-gold tints, not
 * modern green. The feel of a map you'd find in a monastery scriptorium or a
 * leather-bound explorer's journal.
 *
 * CUSTOM FONT: IM Fell English — a revival of a 1672 Fell typeface.
 * Irregular, warm, distinctly pre-modern. Used for ALL text.
 *
 * Parchment rules:
 * - Water is DEEP ultramarine (#1a3a6a), not modern pale blue
 * - Land is warm parchment/vellum — aged, not white
 * - Vegetation is olive-gold, NOT modern green
 * - Roads are brown ink — darker = more important
 * - Labels are dark sepia ink with parchment halos
 * - Everything should feel handmade, warm, aged
 */

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const parchmentColors = {
  // Background & earth - warm parchment
  background: "#c8b888",
  earth: "#d8c8a0",

  // Land use areas - warm parchment variations
  park_a: "#c8c088",
  park_b: "#b8b078",
  hospital: "#d8c8a0",
  industrial: "#c8b890",
  school: "#d0c098",
  wood_a: "#a8a060",
  wood_b: "#8a8848",
  pedestrian: "#d0c098",
  scrub_a: "#b8b070",
  scrub_b: "#a8a060",
  glacier: "#e0d8c0",
  sand: "#d8c8a0",
  beach: "#e0d0a8",
  aerodrome: "#c8c0a0",
  runway: "#b8a888",
  water: "#1a3a6a",
  zoo: "#c0b880",
  military: "#c8b898",

  // Tunnels - parchment casings
  tunnel_other_casing: "#b8a070",
  tunnel_minor_casing: "#b8a070",
  tunnel_link_casing: "#b8a070",
  tunnel_major_casing: "#b8a070",
  tunnel_highway_casing: "#b8a070",
  tunnel_other: "#c8b898",
  tunnel_minor: "#c8b898",
  tunnel_link: "#b8a078",
  tunnel_major: "#a89068",
  tunnel_highway: "#988058",

  // Pier & buildings - warm stone
  pier: "#c0a878",
  buildings: "#c0a878",

  // Roads & casings - brown ink progression
  minor_service_casing: "#b8a070",
  minor_casing: "#b8a070",
  link_casing: "#b8a070",
  major_casing_late: "#b8a070",
  highway_casing_late: "#b8a070",
  other: "#a89068",
  minor_service: "#a89068",
  minor_a: "#9a8058",
  minor_b: "#a89068",
  link: "#8a6a3a",
  major_casing_early: "#b8a070",
  major: "#7a5a2a",
  highway_casing_early: "#b8a070",
  highway: "#6a3a1a",
  railway: "#8a7050",
  boundaries: "#8a6a3a",

  // Waterway label - parchment on dark water
  waterway_label: "#c8b890",

  // Bridges - same brown ink colors
  bridges_other_casing: "#c0a880",
  bridges_minor_casing: "#b8a070",
  bridges_link_casing: "#b8a070",
  bridges_major_casing: "#b8a070",
  bridges_highway_casing: "#b8a070",
  bridges_other: "#a89068",
  bridges_minor: "#9a8058",
  bridges_link: "#8a6a3a",
  bridges_major: "#7a5a2a",
  bridges_highway: "#6a3a1a",

  // Labels - dark sepia ink with PARCHMENT halos
  roads_label_minor: "#6a4a20",
  roads_label_minor_halo: "#d8c8a0",
  roads_label_major: "#5a3a10",
  roads_label_major_halo: "#d8c8a0",
  ocean_label: "#c8b890",
  peak_label: "#5a4020",
  subplace_label: "#6a4a20",
  subplace_label_halo: "#d8c8a0",
  city_label: "#2a1a0a",
  city_label_halo: "#d8c8a0",
  state_label: "#8a7050",
  state_label_halo: "#d8c8a0",
  country_label: "#5a4020",
  address_label: "#6a4a20",
  address_label_halo: "#d8c8a0",

  // POI icon colors - period-appropriate muted palette
  pois: {
    blue: "#1a3a6a",
    green: "#4a6830",
    lapis: "#2a4a7a",
    pink: "#8a5040",
    red: "#8b2500",
    slategray: "#6a5a4a",
    tangerine: "#8b4513",
    turquoise: "#3a5a6a",
  },

  // Landcover fill colors - olive-gold tints, NOT modern green
  landcover: {
    grassland: "rgba(184, 176, 120, 1)",
    barren: "rgba(200, 184, 136, 1)",
    urban_area: "rgba(208, 192, 152, 1)",
    farmland: "rgba(200, 184, 128, 1)",
    glacier: "rgba(224, 216, 192, 1)",
    scrub: "rgba(176, 168, 112, 1)",
    forest: "rgba(138, 136, 72, 1)",
  },
}

/**
 * UI CSS custom properties - medieval manuscript aesthetic
 * Warm parchment panels with dark sepia ink text
 */
const parchmentUI = {
  // Fonts - IM Fell English for everything
  "--font-sans": "'IM Fell English', serif",
  "--font-mono": "'IM Fell English', serif",
  "--font-heading": "'IM Fell English', serif",
  // Backgrounds - warm parchment
  "--bg-base": "#d8c8a0",
  "--bg-raised": "#e4d8b8",
  "--bg-overlay": "#ddd0a8",
  "--bg-input": "#e8dcc0",
  "--bg-inset": "#d0c090",
  "--bg-muted": "#e0d4b0",
  // Text - dark sepia ink
  "--text-primary": "#2a1a0a",
  "--text-secondary": "#5a4020",
  "--text-tertiary": "#8a7050",
  "--text-inverse": "#e8d8b8",
  // Borders - aged paper edge
  "--border": "#b8a070",
  "--border-subtle": "#c8b890",
  // Accent - saddle brown
  "--accent": "#8b4513",
  "--accent-hover": "#a05520",
  "--accent-muted": "#e0d0b0",
  // Tan - brown ink variants
  "--tan": "#7a5a2a",
  "--tan-muted": "#e8d8c0",
  // Pins - brown ink and ultramarine
  "--pin-origin": "#8b4513",
  "--pin-destination": "#1a3a6a",
  "--pin-intermediate": "#6a5a40",
  "--pin-stroke": "#2a1a0a",
  // Status - period-appropriate colors
  "--status-success": "#4a6830",
  "--status-warning": "#b8860b",
  "--status-danger": "#8b2500",
  "--success": "#4a6830",
  "--warning": "#b8860b",
  "--warning-muted": "#e8d8b8",
  // Route - saddle brown
  "--route-line": "#8b4513",
  // Shadows - warm brown tinted, subtle
  "--shadow": "0 2px 8px rgba(42, 26, 10, 0.15)",
  "--shadow-lg": "0 4px 16px rgba(42, 26, 10, 0.20)",
}

/**
 * Overlay configuration - warm brown ink on parchment
 */
const parchmentOverlay = {
  // Hillshade - warm dramatic terrain
  hillshade: {
    exaggeration: 0.6,
    illuminationDirection: 315,
    shadowColor: "#3a2a1a",
    highlightColor: "#f0e8d8",
  },

  // Contours - brown ink elevation lines
  contours: {
    opacityMod: 1.0,
    minorColor: "#a88060",
    minorOpacity: 0.5,
    minorWidth: { z11: 0.5, z14: 1.0 },
    intermediateColor: "#8a6a3a",
    intermediateOpacity: 0.7,
    intermediateWidth: { z8: 0.8, z14: 1.2 },
    indexColor: "#6a4a20",
    indexOpacity: 0.9,
    indexWidth: { z4: 1.2, z14: 1.8 },
    labelColor: "#5a3a10",
    labelHaloColor: "#d8c8a0",
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 10,
    labelFont: ["Noto Sans Regular"],
  },

  // Contours Test - same warm brown
  contoursTest: {
    minorColor: "#a88060",
    intermediateColor: "#8a6a3a",
    indexColor: "#6a4a20",
    labelColor: "#5a3a10",
  },

  // Contours Test 10ft - slightly lighter brown
  contoursTest10ft: {
    minorColor: "#b89070",
    intermediateColor: "#9a7a4a",
    indexColor: "#7a5a30",
    labelColor: "#6a4a20",
  },

  // Public Lands - muted olive-gold fills
  publicLands: {
    opacityMod: 0.8,
    // Fill colors - olive-gold tints
    fillWA: "#b8b070",
    fillNPS: "#a8a060",
    fillUSFS: "#b0a868",
    fillBLM: "#c0b080",
    fillFWS: "#a0a058",
    fillSTAT: "#b8b078",
    fillLOC: "#c0b888",
    fillDefault: "#c8c090",
    // Fill opacities
    fillOpacityWA: 0.25,
    fillOpacityNPS: 0.25,
    fillOpacityUSFS: 0.22,
    fillOpacityBLM: 0.18,
    fillOpacitySTAT: 0.22,
    fillOpacityLOC: 0.18,
    fillOpacityDefault: 0.15,
    // Outline colors - brown ink
    outlineWA: "#8a7040",
    outlineNPS: "#7a6030",
    outlineUSFS: "#8a7040",
    outlineBLM: "#9a8050",
    outlineFWS: "#7a6030",
    outlineSTAT: "#8a7040",
    outlineLOC: "#9a8050",
    outlineDefault: "#a89060",
    // Outline opacities
    outlineOpacityNPS: 0.7,
    outlineOpacityUSFS: 0.6,
    outlineOpacityDefault: 0.5,
    // Outline width
    outlineWidth: { z4: 0.3, z8: 0.8, z12: 1.2 },
    // Labels - sepia ink with parchment halo
    labelColor: "#5a4020",
    labelHaloColor: "#d8c8a0",
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: { z10: 10, z14: 13 },
    labelFont: ["Noto Sans Regular"],
  },

  // USFS Trails - brown/sienna/olive ink family
  usfsTrails: {
    // Roads - brown ink
    roadsColor: "#7a5a2a",
    roadsOpacity: 0.9,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    // Trails - warm earth tones only
    trailsMotorized: "#8b4513",
    trailsBicycle: "#8a6a3a",
    trailsHiker: "#6a5a40",
    trailsDefault: "#7a5a2a",
    trailsOpacity: 0.9,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    // Road labels
    roadsLabelColor: "#5a4020",
    roadsLabelHaloColor: "#d8c8a0",
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.9,
    roadsLabelSize: 11,
    // Trail labels
    trailsLabelColor: "#5a4020",
    trailsLabelHaloColor: "#d8c8a0",
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.9,
    trailsLabelSize: 11,
    labelFont: ["Noto Sans Regular"],
    // Hit layer
    hitWidth: 14,
  },

  // BLM Trails - brown/sienna/olive ink family
  blmTrails: {
    // Route colors - warm earth tones
    color4wdHigh: "#8b4513",
    color4wdLow: "#8a6a3a",
    colorAtv: "#8b2500",
    colorMotoSingle: "#7a5a2a",
    color2wdLow: "#9a7a4a",
    colorNonMech: "#6a5a40",
    colorDefault: "#8a6a3a",
    colorSnow: "#5a6a7a",
    lineOpacity: 0.9,
    lineOpacityOther: 0.85,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    // Dash patterns
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    // Labels
    labelColor: "#5a4020",
    labelHaloColor: "#d8c8a0",
    labelHaloWidth: 1.5,
    labelOpacity: 0.9,
    labelSize: 11,
    labelFont: ["Noto Sans Regular"],
    // Hit layer
    hitWidth: 14,
  },
}

/**
 * Satellite adjustments - warm sepia shift
 */
const parchmentSatellite = {
  opacity: 0.85,
  brightnessMin: 0.0,
  brightnessMax: 0.85,
  contrast: 0.15,
  saturation: -0.4,
  hueRotate: 30,
}

/**
 * Parchment theme configuration
 */
const parchmentTheme = {
  id: "parchment",
  name: "Parchment",
  dark: false,
  swatch: ["#d8c8a0", "#8b4513", "#1a3a6a"],
  fontImports: [
    "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap",
  ],
  colors: parchmentColors,
  satellite: parchmentSatellite,
  overlay: parchmentOverlay,
  ui: parchmentUI,
}

export default parchmentTheme
