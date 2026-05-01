/**
 * Tactical Theme for Navi
 *
 * Green phosphor military display. The aesthetic of night vision goggles,
 * submarine sonar screens, 1980s radar consoles, and classic green-screen
 * terminals. Pure black background with ALL visual information in the green
 * spectrum only.
 *
 * Named "Tactical" because this is the recon/military working display —
 * matches the Echo6/RECON platform identity.
 *
 * Monochrome green rules:
 * - ONLY green and black. No red, no blue, no amber, no white.
 * - Text is green on black, not white on black.
 * - Water is pure black — no blue tint.
 * - The ONLY contrast axis is bright-green to dark-green to black.
 * - The green is warm phosphor green (#00cc44), not cold cyan-green.
 */

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const tacticalColors = {
  // Background & earth - pure black with faint green
  background: "#000800",
  earth: "#000a00",

  // Land use areas - very dark green
  park_a: "#001508",
  park_b: "#001a0a",
  hospital: "#001208",
  industrial: "#001005",
  school: "#001208",
  wood_a: "#001508",
  wood_b: "#001a0a",
  pedestrian: "#000c03",
  scrub_a: "#001206",
  scrub_b: "#001508",
  glacier: "#000e04",
  sand: "#001005",
  beach: "#001206",
  aerodrome: "#000c03",
  runway: "#002a0a",
  water: "#000500",
  zoo: "#001508",
  military: "#001206",

  // Tunnels - black casings
  tunnel_other_casing: "#000a00",
  tunnel_minor_casing: "#000a00",
  tunnel_link_casing: "#000a00",
  tunnel_major_casing: "#000a00",
  tunnel_highway_casing: "#000a00",
  tunnel_other: "#001a08",
  tunnel_minor: "#001a08",
  tunnel_link: "#002a0a",
  tunnel_major: "#003a10",
  tunnel_highway: "#004415",

  // Pier & buildings - very dark green
  pier: "#002a0a",
  buildings: "#001a08",

  // Roads & casings - green spectrum by brightness
  minor_service_casing: "#000a00",
  minor_casing: "#000a00",
  link_casing: "#000a00",
  major_casing_late: "#000a00",
  highway_casing_late: "#000a00",
  other: "#002a0a",
  minor_service: "#002a0a",
  minor_a: "#003a10",
  minor_b: "#002a0a",
  link: "#004415",
  major_casing_early: "#000a00",
  major: "#006622",
  highway_casing_early: "#000a00",
  highway: "#008830",
  railway: "#001a08",
  boundaries: "#004415",

  // Waterway label - dim green on black water
  waterway_label: "#006622",

  // Bridges - same green spectrum
  bridges_other_casing: "#000c03",
  bridges_minor_casing: "#000a00",
  bridges_link_casing: "#000a00",
  bridges_major_casing: "#000a00",
  bridges_highway_casing: "#000a00",
  bridges_other: "#002a0a",
  bridges_minor: "#003a10",
  bridges_link: "#004415",
  bridges_major: "#006622",
  bridges_highway: "#008830",

  // Labels - phosphor green with BLACK halos
  roads_label_minor: "#005520",
  roads_label_minor_halo: "#000a00",
  roads_label_major: "#006622",
  roads_label_major_halo: "#000a00",
  ocean_label: "#006622",
  peak_label: "#006622",
  subplace_label: "#005520",
  subplace_label_halo: "#000a00",
  city_label: "#00cc44",
  city_label_halo: "#000a00",
  state_label: "#004415",
  state_label_halo: "#000a00",
  country_label: "#006622",
  address_label: "#005520",
  address_label_halo: "#000a00",

  // POI icon colors - ALL green spectrum, differentiated by brightness
  pois: {
    blue: "#006622",
    green: "#00aa33",
    lapis: "#005520",
    pink: "#008830",
    red: "#00cc44",
    slategray: "#004415",
    tangerine: "#00aa33",
    turquoise: "#006622",
  },

  // Landcover fill colors - very dark green
  landcover: {
    grassland: "rgba(0, 21, 8, 1)",
    barren: "rgba(0, 16, 5, 1)",
    urban_area: "rgba(0, 12, 3, 1)",
    farmland: "rgba(0, 18, 6, 1)",
    glacier: "rgba(0, 14, 4, 1)",
    scrub: "rgba(0, 18, 8, 1)",
    forest: "rgba(0, 26, 10, 1)",
  },
}

/**
 * UI CSS custom properties - phosphor green terminal
 */
const tacticalUI = {
  "--font-sans": "'Inter', system-ui, -apple-system, sans-serif",
  "--font-mono": "'JetBrains Mono', ui-monospace, monospace",
  "--font-heading": "'Inter', system-ui, -apple-system, sans-serif",
  "--bg-base": "#000a00",
  "--bg-raised": "#001200",
  "--bg-overlay": "#001a05",
  "--bg-input": "#000c02",
  "--bg-inset": "#000800",
  "--bg-muted": "#001505",
  "--text-primary": "#00cc44",
  "--text-secondary": "#008830",
  "--text-tertiary": "#005520",
  "--text-inverse": "#000a00",
  "--border": "#002a0a",
  "--border-subtle": "#001a08",
  "--accent": "#00cc44",
  "--accent-hover": "#00dd55",
  "--accent-muted": "#002a0a",
  "--tan": "#00aa33",
  "--tan-muted": "#001a08",
  "--pin-origin": "#00cc44",
  "--pin-destination": "#00aa33",
  "--pin-intermediate": "#008830",
  "--pin-stroke": "#000a00",
  "--status-success": "#00aa33",
  "--status-warning": "#88aa00",
  "--status-danger": "#cc4400",
  "--success": "#00aa33",
  "--warning": "#88aa00",
  "--warning-muted": "#1a1a00",
  "--route-line": "#00cc44",
  "--shadow": "0 2px 8px rgba(0, 0, 0, 0.8)",
  "--shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.9)",
}

/**
 * Overlay configuration - monochrome green
 */
const tacticalOverlay = {
  hillshade: {
    exaggeration: 0.3,
    illuminationDirection: 315,
    shadowColor: "#000000",
    highlightColor: "#001a08",
  },
  traffic: {
    opacity: 0.4,
  },
  contours: {
    opacityMod: 0.8,
    minorColor: "#003311",
    minorOpacity: 0.5,
    minorWidth: { z11: 0.5, z14: 1.0 },
    intermediateColor: "#004415",
    intermediateOpacity: 0.6,
    intermediateWidth: { z8: 0.8, z14: 1.2 },
    indexColor: "#005520",
    indexOpacity: 0.8,
    indexWidth: { z4: 1.2, z14: 1.8 },
    labelColor: "#006622",
    labelHaloColor: "#000a00",
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: 10,
    labelFont: ["Noto Sans Regular"],
  },
  contoursTest: {
    minorColor: "#003311",
    intermediateColor: "#004415",
    indexColor: "#005520",
    labelColor: "#006622",
  },
  contoursTest10ft: {
    minorColor: "#002a0a",
    intermediateColor: "#003a10",
    indexColor: "#004415",
    labelColor: "#005520",
  },
  publicLands: {
    opacityMod: 0.4,
    fillWA: "#001a08",
    fillNPS: "#001508",
    fillUSFS: "#001a08",
    fillBLM: "#001206",
    fillFWS: "#001508",
    fillSTAT: "#001a08",
    fillLOC: "#001206",
    fillDefault: "#001005",
    fillOpacityWA: 0.20,
    fillOpacityNPS: 0.20,
    fillOpacityUSFS: 0.18,
    fillOpacityBLM: 0.15,
    fillOpacitySTAT: 0.18,
    fillOpacityLOC: 0.15,
    fillOpacityDefault: 0.10,
    outlineWA: "#002a0a",
    outlineNPS: "#002a0a",
    outlineUSFS: "#002a0a",
    outlineBLM: "#001a08",
    outlineFWS: "#002a0a",
    outlineSTAT: "#002a0a",
    outlineLOC: "#001a08",
    outlineDefault: "#001a08",
    outlineOpacityNPS: 0.5,
    outlineOpacityUSFS: 0.4,
    outlineOpacityDefault: 0.3,
    outlineWidth: { z4: 0.3, z8: 0.6, z12: 0.9 },
    labelColor: "#006622",
    labelHaloColor: "#000a00",
    labelHaloWidth: 1.5,
    labelOpacity: 0.7,
    labelSize: { z10: 10, z14: 12 },
    labelFont: ["Noto Sans Regular"],
  },
  usfsTrails: {
    roadsColor: "#004415",
    roadsOpacity: 0.8,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    trailsMotorized: "#008830",
    trailsBicycle: "#006622",
    trailsHiker: "#005520",
    trailsDefault: "#004415",
    trailsOpacity: 0.8,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    roadsLabelColor: "#006622",
    roadsLabelHaloColor: "#000a00",
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.8,
    roadsLabelSize: 11,
    trailsLabelColor: "#006622",
    trailsLabelHaloColor: "#000a00",
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.8,
    trailsLabelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
  blmTrails: {
    color4wdHigh: "#008830",
    color4wdLow: "#006622",
    colorAtv: "#008830",
    colorMotoSingle: "#006622",
    color2wdLow: "#005520",
    colorNonMech: "#005520",
    colorDefault: "#004415",
    colorSnow: "#006622",
    lineOpacity: 0.8,
    lineOpacityOther: 0.7,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    labelColor: "#006622",
    labelHaloColor: "#000a00",
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
}

const tacticalSatellite = {
  opacity: 0.5,
  brightnessMin: 0.0,
  brightnessMax: 0.15,
  contrast: 0.0,
  saturation: -1.0,
  hueRotate: 120,
}

const tacticalTheme = {
  id: "tactical",
  name: "Tactical",
  dark: true,
  swatch: ["#000a00", "#00cc44", "#005520"],
  fontImports: [],
  colors: tacticalColors,
  satellite: tacticalSatellite,
  overlay: tacticalOverlay,
  ui: tacticalUI,
}

export default tacticalTheme
