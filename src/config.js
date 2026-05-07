/**
 * Deployment config loader.
 *
 * Fetches /api/config on startup and caches the result.
 * Falls back to hardcoded defaults matching the home profile if the
 * API is unavailable (backend restart, network issue).
 */

const FALLBACK_CONFIG = {
  profile: 'home',
  region_name: 'North America',
  tileset: {
    url: '/tiles/planet/current.pmtiles',
    bounds: [-168, 14, -52, 72],
    max_zoom: 15,
    attribution: 'Protomaps © OSM',
  },
  services: {
    geocode: '/api/geocode',
    reverse: '/api/reverse',
    address_book: '/api/address_book',
    valhalla: '/valhalla',
  },
  features: {
    has_nominatim_details: false,
    has_kiwix_wiki: false,
    has_hillshade: false,
    has_3d_terrain: false,
    has_traffic_overlay: false,
    has_landclass: false,
    has_public_lands_layer: false,
    has_contours: true,
    has_address_book_write: false,
    has_usfs_trails: false,
    has_blm_trails: false,
    has_contacts: false,
  },
  defaults: {
    center: [42.5736, -114.6066],
    zoom: 10,
  },
}

let _config = null
let _configPromise = null

/**
 * Fetch config from backend. Returns cached config on subsequent calls.
 * Falls back to FALLBACK_CONFIG if API fails.
 */
export function loadConfig() {
  if (_configPromise) return _configPromise

  _configPromise = fetch('/api/config', { signal: AbortSignal.timeout(3000) })
    .then((resp) => {
      if (!resp.ok) throw new Error(`Config API returned ${resp.status}`)
      return resp.json()
    })
    .then((data) => {
      _config = data
      console.log('[navi] Config loaded:', data.profile, `(${data.region_name})`)
      console.log('[navi] Feature flags:', data.features)
      return data
    })
    .catch((err) => {
      console.warn('[navi] Config API unavailable, using fallback:', err.message)
      _config = FALLBACK_CONFIG
      return FALLBACK_CONFIG
    })

  return _configPromise
}

/**
 * Get the current config synchronously. Returns null if not yet loaded.
 */
export function getConfig() {
  return _config
}

/**
 * Check a feature flag from the loaded config.
 * @param {string} flag - Feature flag name (e.g. 'has_hillshade')
 * @returns {boolean}
 */
export function hasFeature(flag) {
  if (!_config) return false
  return Boolean(_config.features?.[flag])
}
