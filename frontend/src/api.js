const GEOCODE_URL = '/api/geocode'
const VALHALLA_URL = '/valhalla/route'
const VALHALLA_OPTIMIZED_URL = '/valhalla/optimized_route'

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
