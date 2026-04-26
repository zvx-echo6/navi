import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { MapPin, Building2, Star, Crosshair, Coffee, Fuel, ShoppingBag, Hotel, X, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { buildAddress } from '../utils/place'
import { searchGeocode } from '../api'
import { hasFeature } from '../config'

/** Get category icon based on result type/source */
function CategoryIcon({ result }) {
  const type = result.type || ''
  const source = result.source || ''
  const size = 14

  if (result._isContact) return <User size={size} />
  if (source === 'nickname') return <Star size={size} />
  if (type === 'coordinates') return <Crosshair size={size} />
  if (type === 'locality' || type === 'city') return <Building2 size={size} />

  // POI subcategories from osm_value if available
  const osmVal = result.raw?.osm_value || ''
  if (osmVal.includes('cafe') || osmVal.includes('coffee')) return <Coffee size={size} />
  if (osmVal.includes('fuel') || osmVal.includes('gas')) return <Fuel size={size} />
  if (osmVal.includes('shop') || osmVal.includes('supermarket')) return <ShoppingBag size={size} />
  if (osmVal.includes('hotel') || osmVal.includes('motel')) return <Hotel size={size} />

  return <MapPin size={size} />
}

const SearchBar = forwardRef(function SearchBar(_, ref) {
  const inputRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }))

  const query = useStore((s) => s.query)
  const results = useStore((s) => s.results)
  const searchLoading = useStore((s) => s.searchLoading)
  const autocompleteOpen = useStore((s) => s.autocompleteOpen)
  const stops = useStore((s) => s.stops)
  const pendingDestination = useStore((s) => s.pendingDestination)
  const contacts = useStore((s) => s.contacts)
  const setQuery = useStore((s) => s.setQuery)
  const setResults = useStore((s) => s.setResults)
  const setSearchLoading = useStore((s) => s.setSearchLoading)
  const setAbortController = useStore((s) => s.setAbortController)
  const setAutocompleteOpen = useStore((s) => s.setAutocompleteOpen)
  const addStop = useStore((s) => s.addStop)
  const setSelectedPlace = useStore((s) => s.setSelectedPlace)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const clearPendingDestination = useStore((s) => s.clearPendingDestination)
  const mapCenter = useStore((s) => s.mapCenter)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const doSearch = useCallback(
    async (q) => {
      const prev = useStore.getState().abortController
      if (prev) prev.abort()

      if (!q.trim()) {
        setResults([])
        setAutocompleteOpen(false)
        setSearchLoading(false)
        return
      }

      // Prepend matching contacts
      let contactResults = []
      if (hasFeature('has_contacts') && contacts.length > 0) {
        const lower = q.trim().toLowerCase()
        contactResults = contacts
          .filter((c) =>
            (c.label || '').toLowerCase().startsWith(lower) ||
            (c.name || '').toLowerCase().startsWith(lower) ||
            (c.call_sign || '').toLowerCase().startsWith(lower)
          )
          .slice(0, 3)
          .map((c) => ({
            lat: c.lat,
            lon: c.lon,
            name: c.label,
            address: c.address || c.name || '',
            type: 'contact',
            source: 'contacts',
            match_code: null,
            raw: { osm_type: c.osm_type, osm_id: c.osm_id, contact: c },
            _isContact: true,
          }))
      }

      const ctrl = new AbortController()
      setAbortController(ctrl)
      setSearchLoading(true)

      try {
        const data = await searchGeocode(q.trim(), 6, ctrl.signal, mapCenter)
        const combined = [...contactResults, ...(data.results || [])]
        setResults(combined)
        setAutocompleteOpen(combined.length > 0)
        setActiveIndex(-1)
      } catch (e) {
        if (e.name !== 'AbortError') {
          // Still show contacts even if geocode fails
          if (contactResults.length > 0) {
            setResults(contactResults)
            setAutocompleteOpen(true)
          } else {
            setResults([])
            setAutocompleteOpen(false)
          }
        }
      } finally {
        setSearchLoading(false)
      }
    },
    [setResults, setAutocompleteOpen, setSearchLoading, setAbortController, contacts]
  )

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 150)
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setAutocompleteOpen(false)
    inputRef.current?.focus()
  }

  const selectResult = (result) => {
    const { pendingDestination: pending } = useStore.getState()

    // Pure contact (no geo) → open edit modal
    if (result._isContact && result.lat == null) {
      setEditingContact(result.raw.contact)
      setQuery('')
      setResults([])
      setAutocompleteOpen(false)
      setActiveIndex(-1)
      return
    }

    if (pending) {
      addStop({ lat: result.lat, lon: result.lon, name: result.name, source: result.source, matchCode: result.match_code })
      addStop({ lat: pending.lat, lon: pending.lon, name: pending.name, source: pending.source, matchCode: pending.matchCode })
      clearPendingDestination()
      toast(`Routing from ${result.name} to ${pending.name}`, { icon: '\u{1F9ED}' })
    } else {
      setSelectedPlace({
        lat: result.lat,
        lon: result.lon,
        name: result.name,
        address: result.address || null,
        type: result.type,
        source: result.source,
        matchCode: result.match_code,
        raw: result.raw || {},
      })
    }

    setQuery('')
    setResults([])
    setAutocompleteOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (!autocompleteOpen || results.length === 0) {
      if (e.key === 'Escape') setAutocompleteOpen(false)
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectResult(results[activeIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        setAutocompleteOpen(false)
        setActiveIndex(-1)
        break
    }
  }

  const atCap = stops.length >= 10

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setAutocompleteOpen(true)}
          placeholder={atCap ? 'Max 10 stops reached' : pendingDestination ? 'Starting point...' : 'Search for a place...'}
          disabled={atCap}
          className="navi-input w-full pr-8"
          aria-label="Search places"
          aria-expanded={autocompleteOpen}
          aria-autocomplete="list"
          role="combobox"
        />
        {/* Clear / Loading indicator */}
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {searchLoading ? (
            <div
              className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
            />
          ) : query ? (
            <button
              onClick={handleClear}
              className="p-0.5"
              style={{ color: 'var(--text-tertiary)' }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Autocomplete dropdown */}
      {autocompleteOpen && results.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full rounded-lg overflow-hidden max-h-72 overflow-y-auto"
          style={{
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)',
          }}
          role="listbox"
        >
          {results.map((r, i) => {
            const isPoi = r.type === 'poi' && r.raw?.name
            const isContact = r._isContact
            const primary = isContact ? r.name : isPoi ? r.raw.name : r.name
            const secondary = isContact ? (r.address || '') : isPoi ? buildAddress(r) : null
            return (
            <li
              key={`${r.lat}-${r.lon}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className="px-3 py-2 cursor-pointer text-sm"
              style={{
                background: i === activeIndex
                  ? 'var(--accent-muted)'
                  : isContact
                    ? 'var(--accent-muted)'
                    : 'transparent',
                borderBottom: i < results.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                opacity: isContact && i !== activeIndex ? 0.85 : 1,
              }}
              onClick={() => selectResult(r)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0" style={{ color: isContact ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  <CategoryIcon result={r} />
                </span>
                <span className="truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                  {primary}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {isContact && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                    >
                      saved
                    </span>
                  )}
                  {r.match_code?.housenumber === 'matched' && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                    >
                      exact
                    </span>
                  )}
                </span>
              </div>
              {secondary && (
                <div className="text-[11px] mt-0.5 ml-6 truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {secondary}
                </div>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
})

export default SearchBar
