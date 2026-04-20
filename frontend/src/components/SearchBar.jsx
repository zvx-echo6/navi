import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../store'
import { searchGeocode } from '../api'

export default function SearchBar() {
  const inputRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef(null)

  const query = useStore((s) => s.query)
  const results = useStore((s) => s.results)
  const searchLoading = useStore((s) => s.searchLoading)
  const autocompleteOpen = useStore((s) => s.autocompleteOpen)
  const stops = useStore((s) => s.stops)
  const setQuery = useStore((s) => s.setQuery)
  const setResults = useStore((s) => s.setResults)
  const setSearchLoading = useStore((s) => s.setSearchLoading)
  const setAbortController = useStore((s) => s.setAbortController)
  const setAutocompleteOpen = useStore((s) => s.setAutocompleteOpen)
  const addStop = useStore((s) => s.addStop)

  // Focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const doSearch = useCallback(
    async (q) => {
      // Abort previous
      const prev = useStore.getState().abortController
      if (prev) prev.abort()

      if (!q.trim()) {
        setResults([])
        setAutocompleteOpen(false)
        setSearchLoading(false)
        return
      }

      const ctrl = new AbortController()
      setAbortController(ctrl)
      setSearchLoading(true)

      try {
        const data = await searchGeocode(q.trim(), 6, ctrl.signal)
        setResults(data.results || [])
        setAutocompleteOpen(data.results?.length > 0)
        setActiveIndex(-1)
      } catch (e) {
        if (e.name !== 'AbortError') {
          setResults([])
          setAutocompleteOpen(false)
        }
      } finally {
        setSearchLoading(false)
      }
    },
    [setResults, setAutocompleteOpen, setSearchLoading, setAbortController]
  )

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 150)
  }

  const selectResult = (result) => {
    addStop({
      lat: result.lat,
      lon: result.lon,
      name: result.name,
      source: result.source,
      matchCode: result.match_code,
    })
    setQuery('')
    setResults([])
    setAutocompleteOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (!autocompleteOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setAutocompleteOpen(false)
      }
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
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setAutocompleteOpen(true)}
            placeholder={atCap ? 'Max 10 stops reached' : 'Search for a place...'}
            disabled={atCap}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            aria-label="Search places"
            aria-expanded={autocompleteOpen}
            aria-autocomplete="list"
            role="combobox"
          />
          {searchLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Autocomplete dropdown */}
      {autocompleteOpen && results.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto"
          role="listbox"
        >
          {results.map((r, i) => (
            <li
              key={`${r.lat}-${r.lon}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`px-3 py-2 cursor-pointer text-sm border-b border-gray-700 last:border-b-0 ${
                i === activeIndex
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-200 hover:bg-gray-700'
              }`}
              onClick={() => selectResult(r)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate flex-1">{r.name}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {r.match_code?.housenumber === 'matched' && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-green-800 text-green-200 rounded font-medium">
                      exact match
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500">{r.source}</span>
                </span>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                {r.type} &middot; {r.confidence}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
