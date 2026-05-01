# Navi Theme System

This directory contains the theme registry and reference files for creating custom map themes.

## Files

- **registry.js** - Theme registry with getTheme(), getThemeColors(), getThemeSprite(), getOverlayConfig(), applyThemeUI(), themeList()
- **dark-flavor-reference.json** - Full namedTheme('dark') output for reference
- **light-flavor-reference.json** - Full namedTheme('light') output for reference

## Creating Custom Themes

Custom themes must provide a complete `colors` object matching the flavor schema from protomaps-themes-base.

### Required Structure

The flavor object has **73 flat color keys** plus **2 nested objects**:

```javascript
{
  // === FLAT COLOR KEYS (73 total) ===

  // Background & earth
  "background": "#34373d",
  "earth": "#1f1f1f",

  // Land use areas
  "park_a": "#1c2421",
  "park_b": "#192a24",
  "hospital": "#252424",
  "industrial": "#222222",
  "school": "#262323",
  "wood_a": "#202121",
  "wood_b": "#202121",
  "pedestrian": "#1e1e1e",
  "scrub_a": "#222323",
  "scrub_b": "#222323",
  "glacier": "#1c1c1c",
  "sand": "#212123",
  "beach": "#28282a",
  "aerodrome": "#1e1e1e",
  "runway": "#333333",
  "water": "#31353f",
  "zoo": "#222323",
  "military": "#242323",
  "pier": "#333333",
  "buildings": "#111111",

  // Tunnels
  "tunnel_other_casing": "#141414",
  "tunnel_minor_casing": "#141414",
  "tunnel_link_casing": "#141414",
  "tunnel_major_casing": "#141414",
  "tunnel_highway_casing": "#141414",
  "tunnel_other": "#292929",
  "tunnel_minor": "#292929",
  "tunnel_link": "#292929",
  "tunnel_major": "#292929",
  "tunnel_highway": "#292929",

  // Roads & casings
  "minor_service_casing": "#1f1f1f",
  "minor_casing": "#1f1f1f",
  "link_casing": "#1f1f1f",
  "major_casing_late": "#1f1f1f",
  "highway_casing_late": "#1f1f1f",
  "major_casing_early": "#1f1f1f",
  "highway_casing_early": "#1f1f1f",
  "other": "#333333",
  "minor_service": "#333333",
  "minor_a": "#3d3d3d",
  "minor_b": "#333333",
  "link": "#3d3d3d",
  "major": "#3d3d3d",
  "highway": "#474747",
  "railway": "#000000",
  "boundaries": "#5b6374",

  // Bridges
  "bridges_other_casing": "#2b2b2b",
  "bridges_minor_casing": "#1f1f1f",
  "bridges_link_casing": "#1f1f1f",
  "bridges_major_casing": "#1f1f1f",
  "bridges_highway_casing": "#1f1f1f",
  "bridges_other": "#333333",
  "bridges_minor": "#333333",
  "bridges_link": "#3d3d3d",
  "bridges_major": "#3d3d3d",
  "bridges_highway": "#474747",

  // Labels
  "waterway_label": "#717784",
  "roads_label_minor": "#525252",
  "roads_label_minor_halo": "#1f1f1f",
  "roads_label_major": "#666666",
  "roads_label_major_halo": "#1f1f1f",
  "ocean_label": "#717784",
  "peak_label": "#898080",
  "subplace_label": "#525252",
  "subplace_label_halo": "#1f1f1f",
  "city_label": "#7a7a7a",
  "city_label_halo": "#212121",
  "state_label": "#3d3d3d",
  "state_label_halo": "#1f1f1f",
  "country_label": "#5c5c5c",
  "address_label": "#525252",
  "address_label_halo": "#1f1f1f",

  // === NESTED OBJECTS (REQUIRED) ===

  // POI icon colors - all 8 keys required
  "pois": {
    "blue": "#4299BB",
    "green": "#30C573",
    "lapis": "#2B5CEA",
    "pink": "#EF56BA",
    "red": "#F2567A",
    "slategray": "#93939F",
    "tangerine": "#F19B6E",
    "turquoise": "#00C3D4"
  },

  // Landcover fill colors - all 7 keys required
  "landcover": {
    "grassland": "rgba(30, 41, 31, 1)",
    "barren": "rgba(38, 38, 36, 1)",
    "urban_area": "rgba(28, 28, 28, 1)",
    "farmland": "rgba(31, 36, 32, 1)",
    "glacier": "rgba(43, 43, 43, 1)",
    "scrub": "rgba(34, 36, 30, 1)",
    "forest": "rgba(28, 41, 37, 1)"
  }
}
```

### Theme Config

Add custom themes to `registry.js`:

```javascript
const themes = {
  // ... existing themes ...

  'sepia': {
    id: 'sepia',
    name: 'Sepia',
    dark: false,  // Affects overlay styling, sprite fallback, and UI cascade
    colors: {
      // Full flavor object (all 73 flat keys + pois + landcover)
    },
    satellite: {
      // Optional: raster adjustments for satellite layer
      opacity: 1.0,
      brightnessMin: 0,
      brightnessMax: 1,
      contrast: 0,
      saturation: 0,
      hueRotate: 0,
    },
    overlay: null,  // Optional: custom overlay config, cascades from dark/light
    ui: null,       // Optional: custom UI CSS vars, cascades from dark/light
  },
}
```

### UI Customization

Each theme can define a `ui` object containing CSS custom properties for the application chrome.
Custom themes cascade from the base dark/light UI based on the `dark` flag.

```javascript
// Full list of UI properties (25 total)
ui: {
  '--bg-base': '#1c1917',
  '--bg-raised': '#252220',
  '--bg-overlay': '#2e2a27',
  '--bg-input': '#201d1a',
  '--text-primary': '#dde3dc',
  '--text-secondary': '#8f9a8e',
  '--text-tertiary': '#5e6b5d',
  '--text-inverse': '#1c1917',
  '--border': '#3a3530',
  '--border-subtle': '#2a2624',
  '--accent': '#7a9a6b',
  '--accent-hover': '#8fad7f',
  '--accent-muted': '#3d4d36',
  '--tan': '#b8a88a',
  '--tan-muted': '#4a4235',
  '--pin-origin': '#6b8f5e',
  '--pin-destination': '#a67c52',
  '--pin-intermediate': '#6b7268',
  '--pin-stroke': '#1c1917',
  '--status-success': '#6b8f5e',
  '--status-warning': '#b89a4a',
  '--status-danger': '#a65c52',
  '--route-line': '#7a9a6b',
  '--shadow': '0 2px 8px rgba(0, 0, 0, 0.4)',
  '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.5)',
}
```

Custom themes only need to specify the properties they want to override:

```javascript
'sepia': {
  id: 'sepia',
  name: 'Sepia',
  dark: false,
  colors: { /* ... */ },
  ui: {
    // Only override what's different from the light theme
    '--accent': '#8a7040',
    '--accent-hover': '#6b5530',
    '--tan': '#8a7556',
  },
}
```

### Overlay Customization

Overlay styling (hillshade, traffic, contours, public lands, USFS trails, BLM trails) is also
configurable per-theme. See `darkOverlay` and `lightOverlay` in registry.js for the full
structure. Custom themes cascade from dark/light based on the `dark` flag.

### Important Notes

1. **All color keys are required** - protomaps-themes-base expects every key
2. **Nested objects matter** - `pois` and `landcover` are objects, not flat keys
3. **Sprite fallback** - Custom themes fall back to dark/light sprite based on `dark` flag
4. **Cascading configs** - overlay and ui configs cascade from dark/light if not specified
5. **CSS vars via JS** - UI CSS properties are applied via `applyThemeUI()`, not CSS selectors
