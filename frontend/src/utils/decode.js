/**
 * Decode a Valhalla/Google-encoded polyline string into [lng, lat] coordinate pairs.
 * Valhalla uses precision 6 by default.
 * @param {string} encoded
 * @param {number} precision - decimal precision (6 for Valhalla)
 * @returns {Array<[number, number]>} Array of [lng, lat] pairs for GeoJSON
 */
export function decodePolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision)
  const coords = []
  let lat = 0
  let lng = 0
  let i = 0

  while (i < encoded.length) {
    let shift = 0
    let result = 0
    let byte

    do {
      byte = encoded.charCodeAt(i++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0

    do {
      byte = encoded.charCodeAt(i++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    lng += result & 1 ? ~(result >> 1) : result >> 1

    coords.push([lng / factor, lat / factor])
  }

  return coords
}
