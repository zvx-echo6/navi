const GEOCODE_URL = '/api/geocode'
const VALHALLA_URL = '/valhalla/route'
const VALHALLA_OPTIMIZED_URL = '/valhalla/optimized_route'
const VALHALLA_HEIGHT_URL = '/valhalla/height'

/**
 * Search geocode API with abort support.
 * @param {string} query
 * @param {number} limit
 * @param {AbortSignal} signal
 * @returns {Promise<{query, results, count}>}
 */
export async function searchGeocode(query, limit = 6, signal) {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  const resp = await fetch(`${GEOCODE_URL}?${params}`, { signal, timeout: 5000 })
  if (!resp.ok) throw new Error(`Geocode error: ${resp.status}`)
  return resp.json()
}

/**
 * Request a route from Valhalla.
 * @param {Array<{lat, lon}>} locations
 * @param {string} costing - 'auto' | 'pedestrian' | 'bicycle'
 * @returns {Promise<object>} Valhalla trip response
 */
export async function requestRoute(locations, costing = 'auto') {
  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    units: 'miles',
    directions_options: { units: 'miles' },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const resp = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}))
      throw new Error(errBody.error || errBody.status_message || `Route error: ${resp.status}`)
    }

    return resp.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Request an optimized route from Valhalla.
 * @param {Array<{lat, lon}>} locations
 * @param {string} costing
 * @returns {Promise<object>} Valhalla optimized trip response
 */
export async function requestOptimizedRoute(locations, costing = 'auto') {
  const body = {
    locations: locations.map((l) => ({ lat: l.lat, lon: l.lon })),
    costing,
    units: 'miles',
    directions_options: { units: 'miles' },
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const resp = await fetch(VALHALLA_OPTIMIZED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}))
      throw new Error(errBody.error || errBody.status_message || `Optimize error: ${resp.status}`)
    }

    return resp.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch elevation for a point via Valhalla height API.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<number|null>} Height in meters, or null on error
 */
export async function fetchElevation(lat, lon) {
  try {
    const resp = await fetch(VALHALLA_HEIGHT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shape: [{ lat, lon }], resample_distance: 100 }),
    })
    if (!resp.ok) return null
    const data = await resp.json()
    if (data.height && data.height.length > 0) return data.height[0]
    return null
  } catch {
    return null
  }
}

const REVERSE_URL = "/api/reverse"

/**
 * Reverse geocode a point. Returns a place object or null.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{lat, lon, name, address, type, source, raw}|null>}
 */
export async function fetchReverse(lat, lon) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) })
    const resp = await fetch(`${REVERSE_URL}?${params}`, { timeout: 5000 })
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data.results || data.results.length === 0) return null
    const r = data.results[0]
    return {
      lat: r.lat,
      lon: r.lon,
      name: r.name,
      address: null,
      type: r.type,
      source: r.source,
      matchCode: null,
      raw: r.raw || {},
    }
  } catch {
    return null
  }
}
