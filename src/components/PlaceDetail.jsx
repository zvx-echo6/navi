import { useEffect, useState, useRef, useCallback } from 'react'
import { X, Navigation, Plus, Bookmark, ChevronDown, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { fetchElevation } from '../api'

/** Meters to feet */
const M_TO_FT = 3.28084

/** Build display address from raw result data */
function buildAddress(place) {
  if (place.address) return place.address
  const raw = place.raw || {}
  const parts = [raw.street, raw.city, raw.state, raw.postcode].filter(Boolean)
  return parts.join(', ') || null
}

/** Copy popover — small dropdown beneath the Copy button */
function CopyPopover({ address, selectedPlace, onClose }) {
  const ref = useRef(null)

  // Close on click-outside
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

export default function PlaceDetail() {
  const selectedPlace = useStore((s) => s.selectedPlace)
  const clearSelectedPlace = useStore((s) => s.clearSelectedPlace)
  const startDirections = useStore((s) => s.startDirections)
  const addStop = useStore((s) => s.addStop)
  const stops = useStore((s) => s.stops)
  const geoPermission = useStore((s) => s.geoPermission)

  const [elevResult, setElevResult] = useState({ lat: null, lon: null, value: null })
  const [isMobile, setIsMobile] = useState(false)
  const [copyForPlace, setCopyForPlace] = useState(null)

  const closeCopy = useCallback(() => setCopyForPlace(null), [])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])


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

  // Derive elevation/loading from comparing result to current place
  const elevLoading = placeLat != null && (elevResult.lat !== placeLat || elevResult.lon !== placeLon)
  const elevation = !elevLoading ? elevResult.value : null

  const placeKey = selectedPlace ? `${selectedPlace.lat},${selectedPlace.lon}` : null
  if (!selectedPlace) return null

  const address = buildAddress(selectedPlace)
  const elevFeet = elevation != null ? Math.round(elevation * M_TO_FT) : null
  const raw = selectedPlace.raw || {}

  // Check if place is already in stops
  const existingStopIndex = stops.findIndex(
    (s) => Math.abs(s.lat - selectedPlace.lat) < 0.00001 && Math.abs(s.lon - selectedPlace.lon) < 0.00001
  )

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
    toast('Saved places coming soon')
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
          {selectedPlace.name}
        </h2>
        {selectedPlace.type && (
          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {selectedPlace.type}
          </span>
        )}
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

      {/* Optional extras */}
      {(raw.opening_hours || raw.website || raw.phone) && (
        <div className="mt-3 flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {raw.opening_hours && <span>{raw.opening_hours}</span>}
          {raw.website && (
            <a
              href={raw.website}
              target="_blank"
              rel="noopener noreferrer"
              className="underline truncate"
              style={{ color: 'var(--accent)' }}
            >
              {raw.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {raw.phone && <span>{raw.phone}</span>}
        </div>
      )}

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

        <button
          onClick={handleSave}
          className="p-2 rounded-lg"
          style={{ background: 'var(--tan-muted)', color: 'var(--tan)', border: '1px solid var(--border)' }}
          aria-label="Save place"
        >
          <Bookmark size={14} />
        </button>

        {/* Copy dropdown */}
        <div className="relative">
          <button
            onClick={() => setCopyForPlace((v) => v === placeKey ? null : placeKey)}
            className="p-2 rounded-lg flex items-center gap-0.5"
            style={{ background: 'var(--tan-muted)', color: 'var(--tan)', border: '1px solid var(--border)' }}
            aria-label="Copy"
          >
            <Copy size={14} />
            <ChevronDown size={10} />
          </button>
          {copyForPlace === placeKey && (
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
          maxHeight: '50vh',
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
