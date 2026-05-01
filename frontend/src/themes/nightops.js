/**
 * Night Ops Theme for Navi
 *
 * Black and red tactical night operations display optimized for absolute
 * darkness. Inspired by military cockpit instruments, submarine control
 * rooms, and ship bridge displays designed for total darkness.
 *
 * Red preserves scotopic (dark-adapted) vision better than any other color.
 * This is MORE aggressive than Tactical — zero ambient light, eyes fully
 * dark-adapted, any non-red light is unacceptable.
 *
 * Red-on-black rules:
 * - ONLY red and black. No green, no blue, no amber, no white, no gray.
 * - Text is red on black, not white on black.
 * - "Bright" means brighter red (#cc3333), "dim" means darker red (#551111).
 * - Water is pure black — no blue tint whatsoever.
 * - Vegetation is very dark red-brown, barely distinguishable from land.
 * - The ONLY contrast axis is light-red to dark-red to black.
 */

/**
 * Map flavor colors - protomaps-themes-base schema
 * All 73 flat keys + pois + landcover nested objects
 */
const nightopsColors = {
  // Background & earth - pure black with faint red
  background: "#0a0000",
  earth: "#080000",

  // Land use areas - very dark red-brown
  park_a: "#120505",
  park_b: "#150606",
  hospital: "#100404",
  industrial: "#0c0303",
  school: "#100404",
  wood_a: "#120505",
  wood_b: "#150606",
  pedestrian: "#0a0202",
  scrub_a: "#100404",
  scrub_b: "#120505",
  glacier: "#0c0303",
  sand: "#0c0303",
  beach: "#100404",
  aerodrome: "#0a0202",
  runway: "#1a0808",
  water: "#050000",
  zoo: "#120505",
  military: "#100404",

  // Tunnels - black casings
  tunnel_other_casing: "#080000",
  tunnel_minor_casing: "#080000",
  tunnel_link_casing: "#080000",
  tunnel_major_casing: "#080000",
  tunnel_highway_casing: "#080000",
  tunnel_other: "#150606",
  tunnel_minor: "#150606",
  tunnel_link: "#1a0808",
  tunnel_major: "#2a0a0a",
  tunnel_highway: "#3a1010",

  // Pier & buildings - very dark red-brown
  pier: "#1a0808",
  buildings: "#150606",

  // Roads & casings - red spectrum by brightness
  minor_service_casing: "#080000",
  minor_casing: "#080000",
  link_casing: "#080000",
  major_casing_late: "#080000",
  highway_casing_late: "#080000",
  other: "#1a0808",
  minor_service: "#1a0808",
  minor_a: "#2a0a0a",
  minor_b: "#1a0808",
  link: "#3a1010",
  major_casing_early: "#080000",
  major: "#551515",
  highway_casing_early: "#080000",
  highway: "#772222",
  railway: "#150606",
  boundaries: "#3a1010",

  // Waterway label - dim red on black water
  waterway_label: "#551515",

  // Bridges - same red spectrum
  bridges_other_casing: "#0a0202",
  bridges_minor_casing: "#080000",
  bridges_link_casing: "#080000",
  bridges_major_casing: "#080000",
  bridges_highway_casing: "#080000",
  bridges_other: "#1a0808",
  bridges_minor: "#2a0a0a",
  bridges_link: "#3a1010",
  bridges_major: "#551515",
  bridges_highway: "#772222",

  // Labels - red with BLACK halos
  roads_label_minor: "#441111",
  roads_label_minor_halo: "#0a0000",
  roads_label_major: "#551515",
  roads_label_major_halo: "#0a0000",
  ocean_label: "#551515",
  peak_label: "#551515",
  subplace_label: "#441111",
  subplace_label_halo: "#0a0000",
  city_label: "#cc3333",
  city_label_halo: "#0a0000",
  state_label: "#3a1010",
  state_label_halo: "#0a0000",
  country_label: "#551515",
  address_label: "#441111",
  address_label_halo: "#0a0000",

  // POI icon colors - ALL red spectrum, differentiated by brightness
  pois: {
    blue: "#551515",
    green: "#882222",
    lapis: "#441111",
    pink: "#772222",
    red: "#cc3333",
    slategray: "#3a1010",
    tangerine: "#882222",
    turquoise: "#551515",
  },

  // Landcover fill colors - very dark red-brown
  landcover: {
    grassland: "rgba(18, 5, 5, 1)",
    barren: "rgba(12, 3, 3, 1)",
    urban_area: "rgba(10, 2, 2, 1)",
    farmland: "rgba(15, 4, 4, 1)",
    glacier: "rgba(12, 3, 3, 1)",
    scrub: "rgba(15, 5, 5, 1)",
    forest: "rgba(21, 6, 6, 1)",
  },
}

/**
 * UI CSS custom properties - red-on-black terminal
 */
const nightopsUI = {
  "--font-sans": "'Inter', system-ui, -apple-system, sans-serif",
  "--font-mono": "'JetBrains Mono', ui-monospace, monospace",
  "--font-heading": "'Inter', system-ui, -apple-system, sans-serif",
  "--bg-base": "#0a0000",
  "--bg-raised": "#120000",
  "--bg-overlay": "#1a0505",
  "--bg-input": "#0c0202",
  "--bg-inset": "#080000",
  "--bg-muted": "#150505",
  "--text-primary": "#cc3333",
  "--text-secondary": "#882222",
  "--text-tertiary": "#551515",
  "--text-inverse": "#0a0000",
  "--border": "#2a0a0a",
  "--border-subtle": "#1a0606",
  "--accent": "#cc3333",
  "--accent-hover": "#dd4444",
  "--accent-muted": "#2a0a0a",
  "--tan": "#aa2222",
  "--tan-muted": "#1a0606",
  "--pin-origin": "#cc3333",
  "--pin-destination": "#aa2222",
  "--pin-intermediate": "#882222",
  "--pin-stroke": "#0a0000",
  "--status-success": "#883322",
  "--status-warning": "#cc4422",
  "--status-danger": "#ff2222",
  "--success": "#883322",
  "--warning": "#cc4422",
  "--warning-muted": "#2a0a05",
  "--route-line": "#cc3333",
  "--shadow": "0 2px 8px rgba(0, 0, 0, 0.8)",
  "--shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.9)",
}

/**
 * Overlay configuration - monochrome red
 */
const nightopsOverlay = {
  hillshade: {
    exaggeration: 0.2,
    illuminationDirection: 315,
    shadowColor: "#000000",
    highlightColor: "#0a0000",
  },
  traffic: {
    opacity: 0.4,
  },
  contours: {
    opacityMod: 0.8,
    minorColor: "#2a0808",
    minorOpacity: 0.5,
    minorWidth: { z11: 0.5, z14: 1.0 },
    intermediateColor: "#3a1010",
    intermediateOpacity: 0.6,
    intermediateWidth: { z8: 0.8, z14: 1.2 },
    indexColor: "#441111",
    indexOpacity: 0.8,
    indexWidth: { z4: 1.2, z14: 1.8 },
    labelColor: "#551515",
    labelHaloColor: "#0a0000",
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: 10,
    labelFont: ["Noto Sans Regular"],
  },
  contoursTest: {
    minorColor: "#2a0808",
    intermediateColor: "#3a1010",
    indexColor: "#441111",
    labelColor: "#551515",
  },
  contoursTest10ft: {
    minorColor: "#1a0606",
    intermediateColor: "#2a0808",
    indexColor: "#3a1010",
    labelColor: "#441111",
  },
  publicLands: {
    opacityMod: 0.4,
    fillWA: "#150606",
    fillNPS: "#120505",
    fillUSFS: "#150606",
    fillBLM: "#100404",
    fillFWS: "#120505",
    fillSTAT: "#150606",
    fillLOC: "#100404",
    fillDefault: "#0c0303",
    fillOpacityWA: 0.20,
    fillOpacityNPS: 0.20,
    fillOpacityUSFS: 0.18,
    fillOpacityBLM: 0.15,
    fillOpacitySTAT: 0.18,
    fillOpacityLOC: 0.15,
    fillOpacityDefault: 0.10,
    outlineWA: "#1a0808",
    outlineNPS: "#1a0808",
    outlineUSFS: "#1a0808",
    outlineBLM: "#150606",
    outlineFWS: "#1a0808",
    outlineSTAT: "#1a0808",
    outlineLOC: "#150606",
    outlineDefault: "#150606",
    outlineOpacityNPS: 0.5,
    outlineOpacityUSFS: 0.4,
    outlineOpacityDefault: 0.3,
    outlineWidth: { z4: 0.3, z8: 0.6, z12: 0.9 },
    labelColor: "#551515",
    labelHaloColor: "#0a0000",
    labelHaloWidth: 1.5,
    labelOpacity: 0.7,
    labelSize: { z10: 10, z14: 12 },
    labelFont: ["Noto Sans Regular"],
  },
  usfsTrails: {
    roadsColor: "#3a1010",
    roadsOpacity: 0.8,
    roadsWidth: { z10: 1.5, z14: 2.5, z16: 3.5 },
    trailsMotorized: "#772222",
    trailsBicycle: "#661818",
    trailsHiker: "#551515",
    trailsDefault: "#3a1010",
    trailsOpacity: 0.8,
    trailsWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    trailsDash: [2, 1.5],
    roadsLabelColor: "#551515",
    roadsLabelHaloColor: "#0a0000",
    roadsLabelHaloWidth: 1.5,
    roadsLabelOpacity: 0.8,
    roadsLabelSize: 11,
    trailsLabelColor: "#551515",
    trailsLabelHaloColor: "#0a0000",
    trailsLabelHaloWidth: 1.5,
    trailsLabelOpacity: 0.8,
    trailsLabelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
  blmTrails: {
    color4wdHigh: "#772222",
    color4wdLow: "#661818",
    colorAtv: "#772222",
    colorMotoSingle: "#661818",
    color2wdLow: "#551515",
    colorNonMech: "#551515",
    colorDefault: "#3a1010",
    colorSnow: "#661818",
    lineOpacity: 0.8,
    lineOpacityOther: 0.7,
    lineWidth: { z10: 2.0, z14: 3.0, z16: 4.0 },
    dashImproved: [4, 2],
    dashAggregate: [1, 2],
    dashSnow: [4, 2, 1, 2],
    dashOther: [4, 2, 1, 2, 1, 2],
    labelColor: "#551515",
    labelHaloColor: "#0a0000",
    labelHaloWidth: 1.5,
    labelOpacity: 0.8,
    labelSize: 11,
    labelFont: ["Noto Sans Regular"],
    hitWidth: 14,
  },
}

const nightopsSatellite = {
  opacity: 0.5,
  brightnessMin: 0.0,
  brightnessMax: 0.15,
  contrast: 0.0,
  saturation: -1.0,
  hueRotate: 0,
}

const nightopsTheme = {
  id: "nightops",
  name: "Night Ops",
  dark: true,
  swatch: ["#0a0000", "#cc3333", "#551515"],
  fontImports: [],
  colors: nightopsColors,
  satellite: nightopsSatellite,
  overlay: nightopsOverlay,
  ui: nightopsUI,
}

export default nightopsTheme
