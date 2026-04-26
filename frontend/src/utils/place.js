/** Build display address from raw result data */
export function buildAddress(place) {
  if (place.address) return place.address
  const raw = place.raw || {}
  const street = raw.housenumber && raw.street
    ? `${raw.housenumber} ${raw.street}`
    : raw.street
  const parts = [street, raw.city, raw.state, raw.postcode].filter(Boolean)
  return parts.join(', ') || null
}
