import { useEffect, useState, useRef, useCallback } from 'react'
import {
  X, Navigation, Plus, Bookmark, ChevronDown, ChevronUp, Copy, LogIn,
  Clock, Phone, Globe, Mail, BookOpen, Info, Trees,
} from 'lucide-react'
import OpeningHours from 'opening_hours'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { fetchElevation, fetchPlaceDetails, fetchPlaceByWikidata, fetchDriveTime, fetchNearbyContacts, fetchLandclass } from '../api'
import { hasFeature } from '../config'
import { buildAddress } from '../utils/place'

/** Meters to feet */
const M_TO_FT = 3.28084

/** Format drive time (seconds) to human-readable string */
function formatDriveTime(seconds) {
  const mins = Math.round(seconds / 60)
  if (mins < 2) return '< 2 min drive'
  if (mins < 120) return `${mins} min drive`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m drive` : `${h}h drive`
}

// ── Opening hours helpers ──────────────────────────────────────────────

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseHours(hoursStr) {
  try {
    const oh = new OpeningHours(hoursStr, { address: { country_code: 'us', state: 'Idaho' } })
    const now = new Date()
    const isOpen = oh.getState(now)
    const nextChange = oh.getNextChange(now)

    let todayStr = ''
    if (isOpen) {
      todayStr = 'Open now'
      if (nextChange) {
        const closeTime = nextChange.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        todayStr += ` \u00b7 Closes at ${closeTime}`
      }
    } else {
      todayStr = 'Closed'
      if (nextChange) {
        const openTime = nextChange.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        const isToday = nextChange.getDate() === now.getDate()
        todayStr += ` \u00b7 Opens ${isToday ? 'at' : 'tomorrow at'} ${openTime}`
      }
    }

    const week = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(now)
      const diff = (d - now.getDay() + 7) % 7
      date.setDate(now.getDate() + diff)
      date.setHours(0, 0, 0, 0)

      const intervals = oh.getOpenIntervals(date, new Date(date.getTime() + 86400000))
      if (intervals.length === 0) {
        week.push({ day: DAY_SHORT[d], hours: 'Closed', isToday: d === now.getDay() })
      } else {
        const parts = intervals.map(([start, end]) => {
          const s = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          const e = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          return `${s} \u2013 ${e}`
        })
        week.push({ day: DAY_SHORT[d], hours: parts.join(', '), isToday: d === now.getDay() })
      }
    }

    return { isOpen, todayStr, week }
  } catch {
    return null
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────

function formatPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

function wheelchairLabel(val) {
  if (!val) return null
  const map = { yes: 'Accessible', limited: 'Limited access', no: 'Not accessible' }
  return map[val.toLowerCase()] || null
}

function wikiUrl(wp) {
  if (!wp) return null
  const match = wp.match(/^([a-z-]+):(.+)$/)
  if (!match) return null
  return `https://${match[1]}.wikipedia.org/wiki/${encodeURIComponent(match[2].replace(/ /g, '_'))}`
}

function wikiLabel(wp) {
  if (!wp) return null
  const match = wp.match(/^[a-z-]+:(.+)$/)
  return match ? match[1].replace(/_/g, ' ') : wp
}

// ── Section wrapper ────────────────────────────────────────────────────

function DetailSection({ label, icon: Icon, first, children }) {
  return (
    <div
      className="place-detail-section"
      style={first ? {} : { borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}
    >
      <div className="place-detail-section-header">
        {Icon && <Icon size={12} style={{ opacity: 0.6 }} />}
        <span>{label}</span>
      </div>
      {children}
    </div>
  )
}

// ── Hours display ──────────────────────────────────────────────────────

function HoursDisplay({ hoursStr, first }) {
  const [expanded, setExpanded] = useState(false)
  const parsed = parseHours(hoursStr)

  if (!parsed) {
    return (
      <DetailSection label="Hours" icon={Clock} first={first}>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{hoursStr}</p>
      </DetailSection>
    )
  }

  return (
    <DetailSection label="Hours" icon={Clock} first={first}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-xs"
        style={{ color: 'var(--text-primary)' }}
      >
        <span>
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
            style={{ background: parsed.isOpen ? 'var(--accent)' : 'var(--tan)' }}
          />
          {parsed.todayStr}
        </span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-0.5">
          {parsed.week.map((d) => (
            <div
              key={d.day}
              className="flex justify-between text-xs"
              style={{
                color: d.isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: d.isToday ? 600 : 400,
              }}
            >
              <span>{d.day}</span>
              <span>{d.hours}</span>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  )
}

// ── Copy popover ───────────────────────────────────────────────────────

function CopyPopover({ address, selectedPlace, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const copyAddress = () => {
    const text = [selectedPlace.name, address].filter(Boolean).join('\n')
    navigator.clipboard.writeText(text).then(
      () => toast('Address copied'),
      () => toast.error('Failed to copy')
    )
    onClose()
  }

  const copyCoords = () => {
    const text = `${selectedPlace.lat.toFixed(6)}, ${selectedPlace.lon.toFixed(6)}`
    navigator.clipboard.writeText(text).then(
      () => toast('Coordinates copied'),
      () => toast.error('Failed to copy')
    )
    onClose()
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-1 right-0 rounded-lg py-1 z-50 min-w-[140px]"
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <button
        onClick={address ? copyAddress : undefined}
        disabled={!address}
        className="w-full text-left px-3 py-1.5 text-xs"
        style={{
          color: address ? 'var(--text-primary)' : 'var(--text-tertiary)',
          cursor: address ? 'pointer' : 'not-allowed',
        }}
        title={!address ? 'No address available' : undefined}
      >
        Address
      </button>
      <button
        onClick={copyCoords}
        className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80"
        style={{ color: 'var(--text-primary)' }}
      >
        Coordinates
      </button>
    </div>
  )
}

// ── Enrichment sections ────────────────────────────────────────────────

function EnrichmentSections({ details }) {
  if (!details) return null

  const { category, extratags } = details
  const et = extratags || {}

  const hasAbout = category
  const hasHours = et.opening_hours
  const hasContact = et.phone || et.website || et.email
  const hasDetails = et.cuisine || et.operator || et.fee || et.wheelchair || et.takeaway
  const hasLinks = et.wikipedia || et.wikidata

  if (!hasAbout && !hasHours && !hasContact && !hasDetails && !hasLinks) return null

  let idx = 0

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {hasAbout && (
        <DetailSection label="About" icon={Info} first={idx++ === 0}>
          <span className="category-badge">{category}</span>
        </DetailSection>
      )}

      {hasHours && <HoursDisplay hoursStr={et.opening_hours} first={idx++ === 0} />}

      {hasContact && (
        <DetailSection label="Contact" icon={Phone} first={idx++ === 0}>
          <div className="flex flex-col gap-1.5">
            {et.phone && (
              <a href={`tel:${et.phone}`} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <Phone size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                {formatPhone(et.phone)}
              </a>
            )}
            {et.website && (
              <a
                href={et.website.startsWith('http') ? et.website : `https://${et.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs truncate"
                style={{ color: 'var(--accent)' }}
              >
                <Globe size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                {et.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
            {et.email && (
              <a href={`mailto:${et.email}`} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                <Mail size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                {et.email}
              </a>
            )}
          </div>
        </DetailSection>
      )}

      {hasDetails && (
        <DetailSection label="Details" icon={Info} first={idx++ === 0}>
          <div className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {et.cuisine && <span>Cuisine: {et.cuisine.replace(/_/g, ' ').replace(/;/g, ', ')}</span>}
            {et.operator && <span>Operated by {et.operator}</span>}
            {et.fee && <span>{et.fee === 'no' ? 'Free' : `Fee: ${et.fee}`}</span>}
            {et.wheelchair && wheelchairLabel(et.wheelchair) && <span>{wheelchairLabel(et.wheelchair)}</span>}
            {et.takeaway === 'yes' && <span>Takeaway available</span>}
          </div>
        </DetailSection>
      )}

      {hasLinks && (
        <DetailSection label="Links" icon={BookOpen} first={idx++ === 0}>
          <div className="flex flex-col gap-1.5">
            {et.wikipedia && wikiUrl(et.wikipedia) && (
              <a
                href={wikiUrl(et.wikipedia)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs"
                style={{ color: 'var(--accent)' }}
              >
                <BookOpen size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                {wikiLabel(et.wikipedia)}
              </a>
            )}
            {et.wikidata && (
              <a
                href={`https://www.wikidata.org/wiki/${et.wikidata}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px]"
                style={{ color: 'var(--text-tertiary)', textDecoration: 'underline' }}
              >
                View on Wikidata
              </a>
            )}
          </div>
        </DetailSection>
      )}
    </div>
  )
}

// ── Skeleton loader ────────────────────────────────────────────────────


// ── Land classification display ──────────────────────────────────────────────────────────────────────

function LandclassSection({ data }) {
  if (!data || data.is_public !== true || !data.classifications?.length) return null

  return (
    <DetailSection label="Public Land" icon={Trees}>
      <div className="flex flex-col gap-2">
        {data.classifications.map((c, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {c.unit_name}
            </span>
            {(c.owner_type || c.manager_name || c.designation_type) && (
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {[c.owner_type, c.manager_name, c.designation_type].filter(Boolean).join(' \u203a ')}
              </span>
            )}
            {c.public_access && c.public_access !== 'Unknown' && (
              <span className="category-badge" style={{ fontSize: '10px', width: 'fit-content' }}>
                {c.public_access}
              </span>
            )}
          </div>
        ))}
      </div>
    </DetailSection>
  )
}

function PrivateLandIndicator({ data }) {
  if (!data || data.is_private !== true) return null
  return (
    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
      Private land
    </p>
  )
}

function EnrichmentSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-2.5 animate-pulse">
      <div className="h-3 rounded w-16" style={{ background: 'var(--border-subtle)' }} />
      <div className="h-3 rounded w-32" style={{ background: 'var(--border-subtle)' }} />
      <div className="h-3 rounded w-24" style={{ background: 'var(--border-subtle)' }} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────

export default function PlaceDetail() {
  const selectedPlace = useStore((s) => s.selectedPlace)
  const clearSelectedPlace = useStore((s) => s.clearSelectedPlace)
  const startDirections = useStore((s) => s.startDirections)
  const addStop = useStore((s) => s.addStop)
  const stops = useStore((s) => s.stops)
  const geoPermission = useStore((s) => s.geoPermission)
  const userLocation = useStore((s) => s.userLocation)
  const contacts = useStore((s) => s.contacts)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const auth = useStore((s) => s.auth)

  const [elevResult, setElevResult] = useState({ lat: null, lon: null, value: null })
  const [isMobile, setIsMobile] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [placeDetails, setPlaceDetails] = useState(null)
  const [driveTime, setDriveTime] = useState(null)
  const [nearbyLabel, setNearbyLabel] = useState(null)
  const [landclass, setLandclass] = useState(null)

  const closeCopy = useCallback(() => setCopyOpen(false), [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close copy popover when place changes
  useEffect(() => { setCopyOpen(false) }, [selectedPlace])

  // Escape key closes panel
  useEffect(() => {
    if (!selectedPlace) return
    function handleKey(e) {
      if (e.key === 'Escape') clearSelectedPlace()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [selectedPlace, clearSelectedPlace])

  // Fetch elevation when place changes
  const placeLat = selectedPlace?.lat
  const placeLon = selectedPlace?.lon
  useEffect(() => {
    if (placeLat == null || placeLon == null) return
    let cancelled = false
    fetchElevation(placeLat, placeLon).then((h) => {
      if (!cancelled) setElevResult({ lat: placeLat, lon: placeLon, value: h })
    })
    return () => { cancelled = true }
  }, [placeLat, placeLon])

  // Fetch place details when place changes (if feature enabled)
  const osmType = selectedPlace?.raw?.osm_type
  const osmId = selectedPlace?.raw?.osm_id
  useEffect(() => {
    if (!hasFeature('has_nominatim_details') || !osmType || !osmId) {
      setPlaceDetails(null)
      return
    }

    const controller = new AbortController()
    setPlaceDetails('loading')

    fetchPlaceDetails(osmType, osmId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setPlaceDetails(data || null)
        // Update selectedPlace with boundary if present
        if (data?.boundary) {
          const current = useStore.getState().selectedPlace
          if (current) {
            useStore.getState().setSelectedPlace({ ...current, boundary: data.boundary })
          }
        }
      }
    })

    return () => controller.abort()
  }, [osmType, osmId])

  // Fetch wikidata enrichment when place has wikidata but no OSM details
  const wikidataId = selectedPlace?.wikidata || selectedPlace?.raw?.wikidata
  useEffect(() => {
    // Skip if OSM details are available (they provide richer data)
    if (osmType && osmId) return
    // Skip if no wikidata ID
    if (!wikidataId) return

    const controller = new AbortController()

    fetchPlaceByWikidata(wikidataId, controller.signal).then((data) => {
      if (!controller.signal.aborted && data) {
        // Merge wikidata info into placeDetails (description, population, etc.)
        setPlaceDetails((prev) => ({
          ...(prev === 'loading' ? {} : prev || {}),
          description: data.description,
          population: data.population,
          osm_relation_id: data.osm_relation_id,
          extratags: {
            ...(prev && prev !== 'loading' ? prev.extratags : {}),
            ...data.extratags,
          },
        }))
        // Update selectedPlace with boundary if present
        if (data?.boundary) {
          const current = useStore.getState().selectedPlace
          if (current) {
            useStore.getState().setSelectedPlace({ ...current, boundary: data.boundary })
          }
        }
      }
    })

    return () => controller.abort()
  }, [wikidataId, osmType, osmId])

  // Fetch drive time when place or user location changes
  useEffect(() => {
    if (!userLocation || placeLat == null || placeLon == null) {
      setDriveTime(null)
      return
    }

    setDriveTime(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    fetchDriveTime(
      userLocation.lat, userLocation.lon,
      placeLat, placeLon,
      controller.signal
    ).then((time) => {
      if (!controller.signal.aborted) setDriveTime(time)
    })

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [userLocation?.lat, userLocation?.lon, placeLat, placeLon])

  // Fetch nearby contacts for proximity annotation
  useEffect(() => {
    if (!hasFeature('has_contacts') || !auth.authenticated || placeLat == null || placeLon == null) {
      setNearbyLabel(null)
      return
    }
    const controller = new AbortController()
    fetchNearbyContacts(placeLat, placeLon, 75, controller.signal).then((nearby) => {
      if (!controller.signal.aborted && nearby.length > 0) {
        setNearbyLabel(nearby[0].label)
      } else if (!controller.signal.aborted) {
        setNearbyLabel(null)
      }
    })
    return () => controller.abort()
  }, [placeLat, placeLon])

  // Fetch land classification when place changes (if feature enabled)
  useEffect(() => {
    if (!hasFeature('has_landclass') || placeLat == null || placeLon == null) {
      setLandclass(null)
      return
    }
    const controller = new AbortController()
    fetchLandclass(placeLat, placeLon, controller.signal).then((data) => {
      if (!controller.signal.aborted && data) {
        setLandclass(data)
        // Upgrade "Dropped pin" name to land summary if reverse geocode didn't resolve
        if (data.summary && useStore.getState().selectedPlace?.name === 'Dropped pin') {
          const current = useStore.getState().selectedPlace
          useStore.getState().setSelectedPlace({ ...current, name: data.summary })
        }
      } else if (!controller.signal.aborted) {
        setLandclass(null)
      }
    })
    return () => controller.abort()
  }, [placeLat, placeLon])

  // Derive elevation/loading from comparing result to current place
  const elevLoading = placeLat != null && (elevResult.lat !== placeLat || elevResult.lon !== placeLon)
  const elevation = !elevLoading ? elevResult.value : null

  if (!selectedPlace) return null

  const address = buildAddress(selectedPlace)
  const elevFeet = elevation != null ? Math.round(elevation * M_TO_FT) : null

  // Check if place is already in stops
  const existingStopIndex = stops.findIndex(
    (s) => Math.abs(s.lat - selectedPlace.lat) < 0.00001 && Math.abs(s.lon - selectedPlace.lon) < 0.00001
  )

  // Check if place is already saved as a contact
  const savedContact = hasFeature('has_contacts')
    ? contacts.find((c) => {
        if (c.osm_type && c.osm_id && osmType && osmId) {
          return c.osm_type === osmType && c.osm_id === osmId
        }
        if (c.lat != null && c.lon != null) {
          return Math.abs(c.lat - selectedPlace.lat) < 0.0001 && Math.abs(c.lon - selectedPlace.lon) < 0.0001
        }
        return false
      })
    : null

  const handleDirections = () => {
    startDirections(selectedPlace)
    if (geoPermission !== 'granted' && stops.length === 0) {
      toast('Set a starting point to get directions', { icon: '\u{1F4CD}' })
    }
  }

  const handleAddStop = () => {
    addStop({
      lat: selectedPlace.lat,
      lon: selectedPlace.lon,
      name: selectedPlace.name,
      source: selectedPlace.source,
      matchCode: selectedPlace.matchCode,
    })
    clearSelectedPlace()
  }

  const handleSave = () => {
    if (!hasFeature('has_contacts')) {
      toast('Saved places coming soon')
      return
    }
    if (savedContact) {
      // Edit existing contact
      setEditingContact(savedContact)
    } else {
      // New contact pre-populated from place
      setEditingContact({
        label: '',
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
        osm_type: osmType || null,
        osm_id: osmId || null,
        address: address || '',
        name: selectedPlace.type === 'poi' && selectedPlace.raw?.name ? selectedPlace.raw.name : '',
      })
    }
  }

  const panelContent = (
    <>
      {/* Close button */}
      <button
        onClick={clearSelectedPlace}
        className="absolute top-3 right-3 p-1 rounded"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Close detail panel"
      >
        <X size={18} />
      </button>

      {/* Place name */}
      <div className="pr-8">
        <h2 className="text-md font-semibold" style={{ color: 'var(--text-primary)' }}>
          {selectedPlace.type === 'poi' && selectedPlace.raw?.name
            ? selectedPlace.raw.name
            : selectedPlace.name}
        </h2>
        {(() => {
          const cat = placeDetails && placeDetails !== 'loading' ? placeDetails.category : null
          const parts = []
          if (cat) parts.push(cat)
          if (nearbyLabel) parts.push(`near ${nearbyLabel}`)
          if (driveTime != null) parts.push(formatDriveTime(driveTime))
          if (parts.length === 0) return null
          return (
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {parts.join(' \u00b7 ')}
            </span>
          )
        })()}
      </div>

      {/* Address */}
      {address && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {address}
        </p>
      )}

      {/* Coordinates + elevation */}
      <div className="mt-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>{selectedPlace.lat.toFixed(6)}, {selectedPlace.lon.toFixed(6)}</span>
        <span className="mx-2">&middot;</span>
        <span>
          {elevLoading ? '...' : elevFeet != null ? `${elevFeet.toLocaleString()} ft` : '\u2014'}
        </span>
      </div>

      {/* OSM enrichment sections */}
      {/* Land classification (PAD-US) */}
      <LandclassSection data={landclass} />
      <PrivateLandIndicator data={landclass} />

      {/* OSM enrichment sections */}
      {placeDetails === 'loading' && <EnrichmentSkeleton />}
      {placeDetails && placeDetails !== 'loading' && <EnrichmentSections details={placeDetails} />}

      {/* Action buttons */}
      <div className="mt-auto pt-4 flex gap-2">
        <button
          onClick={handleDirections}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium"
          style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
        >
          <Navigation size={13} />
          Directions
        </button>

        {existingStopIndex >= 0 ? (
          <span
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
          >
            Added as stop {String.fromCharCode(65 + existingStopIndex)}
          </span>
        ) : (
          <button
            onClick={handleAddStop}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium"
            style={{ background: 'var(--tan-muted)', color: 'var(--tan)', border: '1px solid var(--border)' }}
          >
            <Plus size={13} />
            Add stop
          </button>
        )}

        {auth.authenticated ? (
          <button
            onClick={handleSave}
            className="p-2 rounded-lg"
            style={{
              background: savedContact ? 'var(--accent-muted)' : 'var(--tan-muted)',
              color: savedContact ? 'var(--accent)' : 'var(--tan)',
              border: '1px solid var(--border)',
            }}
            aria-label={savedContact ? 'Edit saved contact' : 'Save place'}
          >
            <Bookmark size={14} fill={savedContact ? 'currentColor' : 'none'} />
          </button>
        ) : (
          <button
            onClick={() => { window.location.href = '/outpost.goauthentik.io/start?rd=%2F' }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border)' }}
            title="Log in to save places"
          >
            <LogIn size={12} />
            <span>Save</span>
          </button>
        )}

        {/* Copy dropdown */}
        <div className="relative">
          <button
            onClick={() => setCopyOpen((v) => !v)}
            className="p-2 rounded-lg flex items-center gap-0.5"
            style={{ background: 'var(--tan-muted)', color: 'var(--tan)', border: '1px solid var(--border)' }}
            aria-label="Copy"
          >
            <Copy size={14} />
            <ChevronDown size={10} />
          </button>
          {copyOpen && (
            <CopyPopover
              address={address}
              selectedPlace={selectedPlace}
              onClose={closeCopy}
            />
          )}
        </div>
      </div>
    </>
  )

  // Mobile: bottom overlay
  if (isMobile) {
    return (
      <div
        className="navi-place-detail navi-place-detail-active fixed bottom-0 left-0 right-0 z-20 p-4 rounded-t-2xl flex flex-col"
        style={{
          background: 'var(--bg-raised)',
          borderTop: '1px solid var(--border)',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {panelContent}
      </div>
    )
  }

  // Desktop: side panel
  return (
    <div
      className="navi-place-detail navi-place-detail-active absolute top-0 z-10 h-full overflow-y-auto p-4 flex flex-col"
      style={{
        left: '20rem',
        width: '360px',
        background: 'var(--bg-raised)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {panelContent}
    </div>
  )
}
