/**
 * Tactical Theme for Navi
 *
 * Military topographic map meets NVG-compatible night display. Dark olive/charcoal
 * base with muted sage greens for text — readable but low-signature. Subdued amber
 * for roads and primary actions (amber preserves night vision better than blue/white).
 * Danger in muted red. Low contrast by design — intentional for night use.
 *
 * Water is dark blue-gray, land is dark olive. Contours are PROMINENT in olive-brown —
 * this is a topo-first theme. The feel is a ruggedized field tablet displaying a
 * mil-spec moving map.
 *
 * Designed for field use and eventual ATAK/iTAK integration.
 * Functional, not decorative.
 */

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const tacticalColors = {
  // Background & earth - dark olive
  background: "#0a0e0a",
  earth: "#0d110d",

  // Land use areas - olive family
  park_a: "#141c14",
  park_b: "#182418",
  hospital: "#1a1818",
  industrial: "#121612",
  school: "#181814",
  wood_a: "#141c14",
  wood_b: "#182418",
  pedestrian: "#101410",
  scrub_a: "#161c16",
  scrub_b: "#182018",
  glacier: "#101814",
  sand: "#181816",
  beach: "#1c1c18",
  aerodrome: "#101410",
  runway: "#2a3028",
  water: "#0a1018",
  zoo: "#141c14",
  military: "#181c18",

  // Tunnels - dark olive casings
  tunnel_other_casing: "#0d110d",
  tunnel_minor_casing: "#0d110d",
  tunnel_link_casing: "#0d110d",
  tunnel_major_casing: "#0d110d",
  tunnel_highway_casing: "#0d110d",
  tunnel_other: "#1a201a",
  tunnel_minor: "#1a201a",
  tunnel_link: "#2a3328",
  tunnel_major: "#4a4830",
  tunnel_highway: "#6a6028",

  // Pier & buildings - olive
  pier: "#2a302a",
  buildings: "#1a221a",

  // Roads & casings - olive to amber progression
  minor_service_casing: "#0d110d",
  minor_casing: "#0d110d",
  link_casing: "#0d110d",
  major_casing_late: "#0d110d",
  highway_casing_late: "#0d110d",
  other: "#2a3328",
  minor_service: "#2a3328",
  minor_a: "#3a4338",
  minor_b: "#2a3328",
  link: "#5a5838",
  major_casing_early: "#0d110d",
  major: "#8a7a40",
  highway_casing_early: "#0d110d",
  highway: "#c89030",
  railway: "#1a201a",
  boundaries: "#4a5a48",

  // Waterway label - muted steel blue
  waterway_label: "#4a6a7a",

  // Bridges - same olive/amber colors
  bridges_other_casing: "#101410",
  bridges_minor_casing: "#0d110d",
  bridges_link_casing: "#0d110d",
  bridges_major_casing: "#0d110d",
  bridges_highway_casing: "#0d110d",
  bridges_other: "#2a3328",
  bridges_minor: "#3a4338",
  bridges_link: "#5a5838",
  bridges_major: "#8a7a40",
  bridges_highway: "#c89030",

  // Labels - sage green with DARK olive halos
  roads_label_minor: "#6a7a60",
  roads_label_minor_halo: "#0d110d",
  roads_label_major: "#8a9a80",
  roads_label_major_halo: "#0d110d",
  ocean_label: "#4a6a7a",
  peak_label: "#7a8a70",
  subplace_label: "#6a7a60",
  subplace_label_halo: "#0d110d",
  city_label: "#a0b090",
  city_label_halo: "#0d110d",
  state_label: "#5a6a50",
  state_label_halo: "#0d110d",
  country_label: "#7a8a70",
  address_label: "#6a7a60",
  address_label_halo: "#0d110d",

  // POI icon colors - olive/amber/sage family, NO bright blues
  pois: {
    blue: "#5a7a6a",
    green: "#5a8a40",
    lapis: "#6a7a50",
    pink: "#8a6a60",
    red: "#aa3333",
    slategray: "#6a7a68",
    tangerine: "#c89030",
    turquoise: "#5a8a70",
  },

  // Landcover fill colors - dark olive family
  landcover: {
    grassland: "rgba(20, 30, 18, 1)",
    barren: "rgba(24, 24, 20, 1)",
    urban_area: "rgba(16, 20, 16, 1)",
    farmland: "rgba(18, 26, 18, 1)",
    glacier: "rgba(16, 24, 20, 1)",
    scrub: "rgba(22, 28, 20, 1)",
    forest: "rgba(24, 36, 28, 1)",
  },
}

/**
 * UI CSS custom properties - tactical field display
 */
const tacticalUI = {
  "--font-sans": "'Inter', system-ui, -apple-system, sans-serif",
  "--font-mono": "'JetBrains Mono', ui-monospace, monospace",
  "--font-heading": "'Inter', system-ui, -apple-system, sans-serif",
  "--bg-base": "#0d110d",
  "--bg-raised": "#141a14",
  "--bg-overlay": "#1a2219",
  "--bg-input": "#101410",
  "--bg-inset": "#0a0e0a",
  "--bg-muted": "#182018",
  "--text-primary": "#a0b090",
  "--text-secondary": "#7a8a70",
  "--text-tertiary": "#5a6a50",
  "--text-inverse": "#0d110d",
  "--border": "#2a332a",
  "--border-subtle": "#1a221a",
  "--accent": "#c89030",
  "--accent-hover": "#d8a040",
  "--accent-muted": "#3a3020",
  "--tan": "#a09060",
  "--tan-muted": "#2a2818",
  "--pin-origin": "#c89030",
  "--pin-destination": "#8aaa70",
  "--pin-intermediate": "#6a7a60",
  "--pin-stroke": "#0d110d",
  "--status-success": "#5a8a40",
  "--status-warning": "#c89030",
  "--status-danger": "#aa3333",
  "--success": "#5a8a40",
  "--warning": "#c89030",
  "--warning-muted": "#2a2818",
  "--route-line": "#c89030",
  "--shadow": "0 2px 8px rgba(0, 0, 0, 0.5)",
  "--shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.6)",
}

/**
 * Overlay configuration - prominent contours, subdued everything else
 */
const tacticalOverlay = {
  hillshade: {
    exaggeration: 0.5,
    illuminationDirection: 315,
    shadowColor: "#000000",
    highlightColor: "#1a221a",
  },
  traffic: {
    opacity: 0.5,
  },
  contours: {
    opacityMod: 1.0,
    minorColor: "#6a5a38",
    minorOpacity: 0.6,
    minorWidth: { z11: 0.6, z14: 1.2 },
    intermediateColor: "#7a6a42",
    intermediateOpacity: 0.8,
    intermediateWidth: { z8: 1.0, z14: 1.5 },
    indexColor: "#8a7a4a",
    indexOpacity: 1.0,
    indexWidth: { z4: 1.5, z14: 2.2 },
    labelColor: "#8a7a58",
    labelHaloColor: "#0d110d",
    labelHaloWidth: 1.5,
    labelOpacity: 0.9,
    labelSize: 10,
    labelFont: ["Noto Sans Regular"],
  },
  contoursTest: {
    minorColor: "#5a5a38",
    intermediateColor: "#6a6a42",
    indexColor: "#7a7a4a",
    labelColor: "#8a8a58",
  },
  contoursTest10ft: {
    minorColor: "#4a5a38",
    intermediateColor: "#5a6a42",
    indexColor: "#6a7a4a",
    labelColor: "#7a8a58",
  },
  publicLands: {
    opacityMod: 0.6,
    fillWA: "#3a4030",
    fillNPS: "#2a3a28",
    fillUSFS: "#344030",
    fillBLM: "#4a4a38",
    fillFWS: "#2a4038",
    fillSTAT: "#344838",
    fillLOC: "#3a4a3a",
    fillDefault: "#3a3a30",
    fillOpacityWA: 0.25,
    fillOpacityNPS: 0.25,
    fillOpacityUSFS: 0.20,
    fillOpacityBLM: 0.18,
    fillOpacitySTAT: 0.22,
    fillOpacityLOC: 0.18,
    fillOpacityDefault: 0.12,
    outlineWA: "#4a5040",
    outlineNPS: "#3a4a38",
    outlineUSFS: "#445040",
    outlineBLM: "#5a5a48",
    outlineFWS: "#3a5048",
    outlineSTAT: "#445848",
    outlineLOC: "#4a5a4a",
    outlineDefault: "#4a4a40",
    outlineOpacityNPS: 0.6,
    outlineOpacityUSFS: 0.5,
    outlineOpacityDefault: 0.4,
    outlineWidth: { z4: 0.3, z8: 0.7, z12: 1.0 },
    labelColor: "#8aaa70",
    labelHaloColor: "#0d110d",
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: { z10: 10, z14: 12 },
    labelFont: ["Noto Sans Regular"],
  },
  usfsTrails: {
    roadsColor: "#8a7a40",
    roadsOpacity: 0.85,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    trailsMotorized: "#c89030",
    trailsBicycle: "#a09040",
    trailsHiker: "#6a9a50",
    trailsDefault: "#8a8a50",
    trailsOpacity: 0.85,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    roadsLabelColor: "#9a9a70",
    roadsLabelHaloColor: "#0d110d",
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.85,
    roadsLabelSize: 11,
    trailsLabelColor: "#8a9a60",
    trailsLabelHaloColor: "#0d110d",
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.85,
    trailsLabelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
  blmTrails: {
    color4wdHigh: "#c89030",
    color4wdLow: "#a08030",
    colorAtv: "#aa5030",
    colorMotoSingle: "#8a7a50",
    color2wdLow: "#b09040",
    colorNonMech: "#6a9a50",
    colorDefault: "#8a8a50",
    colorSnow: "#6a8a7a",
    lineOpacity: 0.85,
    lineOpacityOther: 0.75,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    labelColor: "#9a9a70",
    labelHaloColor: "#0d110d",
    labelHaloWidth: 1.5,
    labelOpacity: 0.85,
    labelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
}

const tacticalSatellite = {
  opacity: 0.75,
  brightnessMin: 0.0,
  brightnessMax: 0.35,
  contrast: 0.0,
  saturation: -0.7,
  hueRotate: 0,
}

const tacticalTheme = {
  id: "tactical",
  name: "Tactical",
  dark: true,
  swatch: ["#0d110d", "#c89030", "#a0b090"],
  fontImports: [],
  colors: tacticalColors,
  satellite: tacticalSatellite,
  overlay: tacticalOverlay,
  ui: tacticalUI,
}

export default tacticalTheme
