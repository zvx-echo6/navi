import { useRef, useEffect, useCallback, useState } from "react"
import { MapPin, Crosshair, X, Navigation2, User, Star, Coffee, Fuel, ShoppingBag, Hotel, Building2, Target } from "lucide-react"
import toast from "react-hot-toast"
import { useStore } from "../store"
import { searchGeocode } from "../api"
import { buildAddress } from "../utils/place"
import { hasFeature } from "../config"

/** Parse coordinate input like "42.35, -114.30" */
function parseCoordinates(input) {
  if (!input) return null
  const pattern = /^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/
  const match = input.trim().match(pattern)
  if (!match) return null
  const lat = parseFloat(match[1])
  const lon = parseFloat(match[2])
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

function CategoryIcon({ result, size = 14 }) {
  const type = result.type || ""
  const source = result.source || ""
  if (result._isContact) return <User size={size} />
  if (source === "nickname") return <Star size={size} />
  if (type === "coordinates") return <Crosshair size={size} />
  if (type === "locality" || type === "city") return <Building2 size={size} />
  const osmVal = result.raw?.osm_value || ""
  if (osmVal.includes("cafe") || osmVal.includes("coffee")) return <Coffee size={size} />
  if (osmVal.includes("fuel") || osmVal.includes("gas")) return <Fuel size={size} />
  if (osmVal.includes("shop") || osmVal.includes("supermarket")) return <ShoppingBag size={size} />
  if (osmVal.includes("hotel") || osmVal.includes("motel")) return <Hotel size={size} />
  return <MapPin size={size} />
}

export default function LocationInput({
  value,          // { lat, lon, name } or null
  onChange,       // (place) => void
  placeholder,
  icon,           // "origin" | "destination" | "stop"
  fieldId,        // unique id for this field (for map click targeting)
  onFocus,        // () => void
  autoFocus,
}) {
  const inputRef = useRef(null)
  const [query, setQuery] = useState(value?.name || "")
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)

  const contacts = useStore((s) => s.contacts)
  const activeDirectionsField = useStore((s) => s.activeDirectionsField)
  const setActiveDirectionsField = useStore((s) => s.setActiveDirectionsField)
  const pickingRouteField = useStore((s) => s.pickingRouteField)
  const setPickingRouteField = useStore((s) => s.setPickingRouteField)

  // Sync display value when external value changes
  useEffect(() => {
    if (value?.name && value.name !== query) {
      setQuery(value.name)
    } else if (!value && query && !open) {
      // Value cleared externally
      setQuery("")
    }
  }, [value?.name, value?.lat, value?.lon])

  const doSearch = useCallback(async (q) => {
    if (abortRef.current) abortRef.current.abort()

    if (!q.trim()) {
      setResults([])
      setOpen(false)
      setLoading(false)
      return
    }

    // Check coordinates first
    const coords = parseCoordinates(q)
    if (coords) {
      const coordResult = {
        lat: coords.lat,
        lon: coords.lon,
        name: coords.lat.toFixed(5) + ", " + coords.lon.toFixed(5),
        address: "Coordinates",
        type: "coordinates",
        source: "coordinates",
        match_code: null,
        raw: {},
      }
      setResults([coordResult])
      setOpen(true)
      setLoading(false)
      return
    }

    // Contact matches
    let contactResults = []
    if (hasFeature("has_contacts") && contacts.length > 0) {
      const lower = q.trim().toLowerCase()
      contactResults = contacts
        .filter((c) =>
          (c.label || "").toLowerCase().startsWith(lower) ||
          (c.name || "").toLowerCase().startsWith(lower) ||
          (c.call_sign || "").toLowerCase().startsWith(lower)
        )
        .slice(0, 3)
        .map((c) => ({
          lat: c.lat,
          lon: c.lon,
          name: c.label,
          address: c.address || c.name || "",
          type: "contact",
          source: "contacts",
          match_code: null,
          raw: { contact: c },
          _isContact: true,
        }))
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)

    try {
      const data = await searchGeocode(q.trim(), 5, ctrl.signal)
      const combined = [...contactResults, ...(data.results || [])]
      setResults(combined)
      setOpen(combined.length > 0)
      setActiveIndex(-1)
    } catch (e) {
      if (e.name !== "AbortError") {
        if (contactResults.length > 0) {
          setResults(contactResults)
          setOpen(true)
        } else {
          setResults([])
          setOpen(false)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [contacts])

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 150)
  }

  const handleClear = () => {
    setQuery("")
    setResults([])
    setOpen(false)
    onChange(null)
    inputRef.current?.focus()
  }

  const selectResult = (result) => {
    onChange({
      lat: result.lat,
      lon: result.lon,
      name: result.name,
      source: result.source,
      matchCode: result.match_code,
    })
    setQuery(result.name)
    setResults([])
    setOpen(false)
    setActiveIndex(-1)
  }

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) {
      if (e.key === "Escape") setOpen(false)
      return
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setActiveIndex((prev) => Math.max(prev - 1, -1))
        break
      case "Enter":
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectResult(results[activeIndex])
        }
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
        break
    }
  }

  const handleFocus = () => {
    setActiveDirectionsField(fieldId)  // For styling only, not map clicks
    if (results.length > 0) setOpen(true)
    onFocus?.()
  }

  const handlePickFromMap = () => {
    setPickingRouteField(fieldId)
    toast("Click map to set location", { icon: "🎯", duration: 3000 })
    inputRef.current?.blur()  // Unfocus input so user focuses on map
  }

  const isPicking = pickingRouteField === fieldId

  const handleBlur = () => {
    // Delay to allow click on dropdown
    setTimeout(() => setOpen(false), 150)
  }

  const isActive = activeDirectionsField === fieldId

  const iconColor = icon === "origin" ? "#22c55e" : icon === "destination" ? "#ef4444" : "var(--text-tertiary)"

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
        style={{
          background: "var(--bg-overlay)",
          border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
        }}
      >
        {icon === "origin" ? (
          <Navigation2 size={16} style={{ color: iconColor, transform: "rotate(45deg)" }} />
        ) : (
          <MapPin size={16} style={{ color: iconColor }} />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text-primary)" }}
        />
        {/* Pick from map button */}
        <button
          onClick={handlePickFromMap}
          className="p-1 rounded hover:bg-[var(--bg-overlay)] transition-colors"
          style={{ color: isPicking ? "var(--accent)" : "var(--text-tertiary)" }}
          title="Pick location from map"
        >
          <Target size={14} />
        </button>
        {loading ? (
          <div
            className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          />
        ) : query ? (
          <button onClick={handleClear} className="p-0.5" style={{ color: "var(--text-tertiary)" }}>
            <X size={14} />
          </button>
        ) : null}
      </div>

      {open && results.length > 0 && (
        <ul
          className="absolute z-50 mt-1 w-full rounded-lg overflow-hidden max-h-48 overflow-y-auto"
          style={{
            background: "var(--bg-overlay)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {results.map((r, i) => {
            const isPoi = r.type === "poi" && r.raw?.name
            const isContact = r._isContact
            const primary = isContact ? r.name : isPoi ? r.raw.name : r.name
            const secondary = isContact ? (r.address || "") : isPoi ? buildAddress(r) : null
            return (
              <li
                key={`${r.lat}-${r.lon}-${i}`}
                className="px-3 py-2 cursor-pointer text-sm"
                style={{
                  background: i === activeIndex ? "var(--accent-muted)" : "transparent",
                  borderBottom: i < results.length - 1 ? "1px solid var(--border-subtle)" : "none",
                }}
                onClick={() => selectResult(r)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color: isContact ? "var(--accent)" : "var(--text-tertiary)" }}>
                    <CategoryIcon result={r} />
                  </span>
                  <span className="truncate flex-1" style={{ color: "var(--text-primary)" }}>
                    {primary}
                  </span>
                </div>
                {secondary && (
                  <div className="text-[11px] mt-0.5 ml-6 truncate" style={{ color: "var(--text-tertiary)" }}>
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
}
