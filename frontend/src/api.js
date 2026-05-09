import { useStore } from './store'

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
  // Read current mapCenter directly from store (non-reactive, correct for non-component code)
  const mapCenter = useStore.getState().mapCenter
  if (mapCenter?.lat != null && Number.isFinite(mapCenter.lat)) {
    params.set('lat', String(mapCenter.lat))
  }
  if (mapCenter?.lon != null && Number.isFinite(mapCenter.lon)) {
    params.set('lon', String(mapCenter.lon))
  }
  if (mapCenter?.zoom != null && Number.isFinite(mapCenter.zoom)) {
    params.set('zoom', String(Math.round(mapCenter.zoom)))
  }
  const resp = await fetch(`${GEOCODE_URL}?${params}`, { signal: signal ?? AbortSignal.timeout(5000) })
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
    const resp = await fetch(`${REVERSE_URL}?${params}`, { signal: AbortSignal.timeout(5000) })
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


/**
 * Fetch drive time between two points via Valhalla route.
 * @param {number} oLat - Origin latitude
 * @param {number} oLon - Origin longitude
 * @param {number} dLat - Destination latitude
 * @param {number} dLon - Destination longitude
 * @param {AbortSignal} signal - AbortController signal
 * @returns {Promise<number|null>} Drive time in seconds, or null on error
 */
export async function fetchDriveTime(oLat, oLon, dLat, dLon, signal) {
  try {
    const resp = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [{ lat: oLat, lon: oLon }, { lat: dLat, lon: dLon }],
        costing: 'auto',
      }),
      signal,
    })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.trip?.summary?.time ?? null
  } catch {
    return null
  }
}

/**
 * Fetch enriched place details from the place detail proxy.
 * @param {string} osmType - N, W, or R
 * @param {number} osmId - OSM element ID
 * @param {AbortSignal} signal - AbortController signal for cancellation
 * @returns {Promise<object|null>} Cleaned place detail object, or null on error
 */
export async function fetchPlaceDetails(osmType, osmId, signal) {
  try {
    const resp = await fetch(`/api/place/${osmType}/${osmId}`, {
      signal,
      headers: { 'Accept': 'application/json' },
    })
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}

export async function fetchPlaceByWikidata(wikidataId, signal) {
  try {
    const resp = await fetch(`/api/place/wikidata/${wikidataId}`, {
      signal,
      headers: { "Accept": "application/json" },
    })
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}

// ── Contacts API ──

export async function fetchContacts(signal) {
  try {
    const resp = await fetch('/api/contacts', { signal })
    if (resp.status === 401) return { auth: false }
    if (!resp.ok) throw new Error(`Contacts error: ${resp.status}`)
    return resp.json()
  } catch (e) {
    if (e.name === 'AbortError') throw e
    return []
  }
}

export async function createContact(data) {
  const resp = await fetch('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (resp.status === 401) return { auth: false }
  return resp.json().then((d) => ({ ...d, _status: resp.status }))
}

export async function updateContact(id, data) {
  const resp = await fetch(`/api/contacts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (resp.status === 401) return { auth: false }
  return resp.json()
}

export async function deleteContact(id) {
  const resp = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
  if (resp.status === 401) return { auth: false }
  return resp.json()
}

export async function fetchNearbyContacts(lat, lon, radiusM, signal) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radius_m: String(radiusM) })
    const resp = await fetch(`/api/contacts/nearby?${params}`, { signal })
    if (resp.status === 401) return []
    if (!resp.ok) return []
    return resp.json()
  } catch {
    return []
  }
}

/**
 * Fetch PAD-US land classification for a point.
 * @param {number} lat
 * @param {number} lon
 * @param {AbortSignal} signal
 * @returns {Promise<object|null>} Classification data or null on error
 */
export async function fetchLandclass(lat, lon, signal) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) })
    const resp = await fetch(`/api/landclass?${params}`, { signal })
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}


// ── Auth API ──

/**
 * Check authentication state via whoami endpoint.
 *
 * PATTERN: Uses fetch with redirect:'manual' to detect Authentik SSO state
 * without triggering browser navigation. When unauthenticated, Caddy's
 * forward_auth returns a 302 redirect to Authentik. With redirect:'manual',
 * the browser exposes this as resp.type === 'opaqueredirect' instead of
 * following the redirect.
 *
 * DEPENDENCIES:
 * - /api/auth/whoami must be in Caddy's @authed_user path matcher
 * - Authentik proxy outpost must return 302 (not 401) for unauthed requests
 * - If Authentik changes to return 401, update the status check below
 *
 * @returns {Promise<{authenticated: boolean, username: string|null}>}
 */
export async function fetchAuthState() {
  try {
    const resp = await fetch('/api/auth/whoami', { redirect: 'manual' })
    // Redirect response means unauthenticated (Authentik SSO flow)
    if (resp.type === 'opaqueredirect' || resp.status === 302) {
      return { authenticated: false, username: null }
    }
    if (!resp.ok) {
      return { authenticated: false, username: null }
    }
    return resp.json()
  } catch {
    return { authenticated: false, username: null }
  }
}

// ── Offroute API ──

const OFFROUTE_URL = "/api/offroute"
const MVUM_URL = "/api/mvum"

/**
 * Request an offroute route from the pathfinder API.
 * @param {object} start - { lat, lon }
 * @param {object} end - { lat, lon }
 * @param {string} mode - foot | mtb | atv | vehicle
 * @param {string} boundaryMode - strict | pragmatic | emergency
 * @returns {Promise<object>} Offroute response with GeoJSON route
 */
export async function requestOffroute(start, end, mode = "foot", boundaryMode = "strict") {
  const body = {
    start: [start.lat, start.lon],
    end: [end.lat, end.lon],
    mode,
    boundary_mode: boundaryMode,
  }
  console.log('[TRACE-API] requestOffroute body:', JSON.stringify(body))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000) // 2 min timeout for complex routes

  try {
    const resp = await fetch(OFFROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}))
      throw new Error(errBody.message || 'Could not find a route. Try a different start point or mode.')
    }

    return resp.json()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch MVUM (Motor Vehicle Use Map) info for a location.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radius - Search radius in meters
 * @returns {Promise<object|null>} MVUM feature info or null
 */
export async function fetchMvumInfo(lat, lon, radius = 500) {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: String(radius),
    })
    const resp = await fetch(`${MVUM_URL}?${params}`, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null
    const data = await resp.json()
    return data.feature || null
  } catch {
    return null
  }
}
