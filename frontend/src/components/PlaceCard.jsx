import { useEffect, useState, useRef, useCallback } from "react"
import {
  X, Navigation, Plus, Bookmark, ChevronDown, ChevronUp, Copy, LogIn,
  Clock, Phone, Globe, Mail, BookOpen, Info, Trees, GripVertical,
} from "lucide-react"
import OpeningHours from "opening_hours"
import toast from "react-hot-toast"
import { useStore } from "../store"
import { fetchElevation, fetchPlaceDetails, fetchPlaceByWikidata, fetchDriveTime, fetchNearbyContacts, fetchLandclass } from "../api"
import { hasFeature } from "../config"
import { buildAddress } from "../utils/place"

const M_TO_FT = 3.28084

function formatDriveTime(seconds) {
  const mins = Math.round(seconds / 60)
  if (mins < 2) return "< 2 min"
  if (mins < 120) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function parseHours(hoursStr) {
  try {
    const oh = new OpeningHours(hoursStr, { address: { country_code: "us", state: "Idaho" } })
    const now = new Date()
    const isOpen = oh.getState(now)
    const nextChange = oh.getNextChange(now)
    let todayStr = ""
    if (isOpen) {
      todayStr = "Open now"
      if (nextChange) {
        const closeTime = nextChange.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        todayStr += " \u00b7 Closes " + closeTime
      }
    } else {
      todayStr = "Closed"
      if (nextChange) {
        const openTime = nextChange.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        const isTodayOpen = nextChange.getDate() === now.getDate()
        todayStr += " \u00b7 Opens " + (isTodayOpen ? "at " : "tomorrow ") + openTime
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
        week.push({ day: DAY_SHORT[d], hours: "Closed", isTodayRow: d === now.getDay() })
      } else {
        const parts = intervals.map(([start, end]) => {
          const s = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          const e = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          return s + " \u2013 " + e
        })
        week.push({ day: DAY_SHORT[d], hours: parts.join(", "), isTodayRow: d === now.getDay() })
      }
    }
    return { isOpen, todayStr, week }
  } catch {
    return null
  }
}

function formatPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, "")
  if (digits.length === 11 && digits[0] === "1") {
    return "(" + digits.slice(1, 4) + ") " + digits.slice(4, 7) + "-" + digits.slice(7)
  }
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6)
  }
  return phone
}

function wheelchairLabel(val) {
  if (!val) return null
  const map = { yes: "Accessible", limited: "Limited access", no: "Not accessible" }
  return map[val.toLowerCase()] || null
}

function wikiUrl(wp) {
  if (!wp) return null
  const [lang, ...rest] = wp.split(":")
  const title = rest.join(":").replace(/ /g, "_")
  return "https://" + lang + ".wikipedia.org/wiki/" + encodeURIComponent(title)
}

function wikiLabel(wp) {
  if (!wp) return null
  const [, ...rest] = wp.split(":")
  return rest.join(":").replace(/_/g, " ")
}

function DetailSection({ label, icon: Icon, first, children }) {
  return (
    <div className="text-xs" style={{ paddingTop: first ? 0 : "0.5rem", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: "var(--text-tertiary)" }}>
        <Icon size={12} />
        <span className="uppercase text-[10px] font-medium tracking-wide">{label}</span>
      </div>
      {children}
    </div>
  )
}

function HoursDisplay({ hoursStr, first }) {
  const [expanded, setExpanded] = useState(false)
  const parsed = parseHours(hoursStr)
  if (!parsed) return null
  const { isOpen, todayStr, week } = parsed
  return (
    <DetailSection label="Hours" icon={Clock} first={first}>
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between text-xs" style={{ color: "var(--text-primary)" }}>
        <span style={{ color: isOpen ? "var(--success)" : "var(--text-tertiary)" }}>{todayStr}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-0.5 text-[11px]">
          {week.map((w) => (
            <div key={w.day} className="flex justify-between" style={{ color: w.isTodayRow ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: w.isTodayRow ? 500 : 400 }}>
              <span>{w.day}</span>
              <span>{w.hours}</span>
            </div>
          ))}
        </div>
      )}
    </DetailSection>
  )
}

function LandclassSection({ data }) {
  if (!data || !data.summary) return null
  return (
    <div className="mt-2 flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
      <Trees size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 1 }} />
      <div className="flex flex-col gap-0.5">
        <span>{data.summary}</span>
        {data.unit_name && <span style={{ color: "var(--text-tertiary)" }}>{data.unit_name}</span>}
      </div>
    </div>
  )
}

function PrivateLandIndicator({ data }) {
  if (!data || data.gap_status !== "4") return null
  return (
    <div className="mt-2 px-2 py-1.5 rounded text-xs" style={{ background: "var(--warning-muted)", color: "var(--warning)", border: "1px solid var(--warning)" }}>
      Private land — permission required
    </div>
  )
}

function EnrichmentSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-3 animate-pulse">
      <div className="h-3 rounded w-1/3" style={{ background: "var(--bg-inset)" }} />
      <div className="h-3 rounded w-2/3" style={{ background: "var(--bg-inset)" }} />
      <div className="h-3 rounded w-1/2" style={{ background: "var(--bg-inset)" }} />
    </div>
  )
}

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
            {et.phone && <a href={"tel:" + et.phone} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-primary)" }}><Phone size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />{formatPhone(et.phone)}</a>}
            {et.website && <a href={et.website.startsWith("http") ? et.website : "https://" + et.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs truncate" style={{ color: "var(--accent)" }}><Globe size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />{et.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}
            {et.email && <a href={"mailto:" + et.email} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-primary)" }}><Mail size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />{et.email}</a>}
          </div>
        </DetailSection>
      )}
      {hasDetails && (
        <DetailSection label="Details" icon={Info} first={idx++ === 0}>
          <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {et.cuisine && <span>Cuisine: {et.cuisine.replace(/_/g, " ").replace(/;/g, ", ")}</span>}
            {et.operator && <span>Operated by {et.operator}</span>}
            {et.fee && <span>{et.fee === "no" ? "Free" : "Fee: " + et.fee}</span>}
            {et.wheelchair && wheelchairLabel(et.wheelchair) && <span>{wheelchairLabel(et.wheelchair)}</span>}
            {et.takeaway === "yes" && <span>Takeaway available</span>}
          </div>
        </DetailSection>
      )}
      {hasLinks && (
        <DetailSection label="Links" icon={BookOpen} first={idx++ === 0}>
          <div className="flex flex-col gap-1.5">
            {et.wikipedia && wikiUrl(et.wikipedia) && <a href={wikiUrl(et.wikipedia)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs" style={{ color: "var(--accent)" }}><BookOpen size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />{wikiLabel(et.wikipedia)}</a>}
            {et.wikidata && <a href={"https://www.wikidata.org/wiki/" + et.wikidata} target="_blank" rel="noopener noreferrer" className="text-[11px]" style={{ color: "var(--text-tertiary)", textDecoration: "underline" }}>View on Wikidata</a>}
          </div>
        </DetailSection>
      )}
    </div>
  )
}

function CopyPopover({ address, place, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [onClose])
  const copyAddress = () => {
    const text = [place.name, address].filter(Boolean).join("\n")
    navigator.clipboard.writeText(text).then(() => toast("Address copied"), () => toast.error("Failed to copy"))
    onClose()
  }
  const copyCoords = () => {
    const text = place.lat.toFixed(6) + ", " + place.lon.toFixed(6)
    navigator.clipboard.writeText(text).then(() => toast("Coordinates copied"), () => toast.error("Failed to copy"))
    onClose()
  }
  return (
    <div ref={ref} className="absolute bottom-full mb-1 right-0 rounded-lg py-1 z-50 min-w-[140px]" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
      <button onClick={address ? copyAddress : undefined} disabled={!address} className="w-full text-left px-3 py-1.5 text-xs" style={{ color: address ? "var(--text-primary)" : "var(--text-tertiary)", cursor: address ? "pointer" : "not-allowed" }}>Address</button>
      <button onClick={copyCoords} className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80" style={{ color: "var(--text-primary)" }}>Coordinates</button>
    </div>
  )
}

export function PlaceCard({ place, variant = "preview", expanded = true, onToggleExpand, onClose, onRemove, stopIndex, draggable = false, dragHandleProps = {} }) {
  const contacts = useStore((s) => s.contacts)
  const userLocation = useStore((s) => s.userLocation)
  const stops = useStore((s) => s.stops)
  const geoPermission = useStore((s) => s.geoPermission)
  const addStop = useStore((s) => s.addStop)
  const startDirections = useStore((s) => s.startDirections)
  const clearSelectedPlace = useStore((s) => s.clearSelectedPlace)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const auth = useStore((s) => s.auth)
  const [elevResult, setElevResult] = useState({ lat: null, lon: null, value: null })
  const [placeDetails, setPlaceDetails] = useState(null)
  const [driveTime, setDriveTime] = useState(null)
  const [nearbyLabel, setNearbyLabel] = useState(null)
  const [landclass, setLandclass] = useState(null)
  const [copyOpen, setCopyOpen] = useState(false)

  const placeLat = place?.lat
  const placeLon = place?.lon
  const osmType = place?.raw?.osm_type
  const osmId = place?.raw?.osm_id
  const wikidataId = place?.wikidata || place?.raw?.wikidata

  useEffect(() => {
    if (placeLat == null || placeLon == null) return
    let cancelled = false
    fetchElevation(placeLat, placeLon).then((h) => { if (!cancelled) setElevResult({ lat: placeLat, lon: placeLon, value: h }) })
    return () => { cancelled = true }
  }, [placeLat, placeLon])

  useEffect(() => {
    if (!hasFeature("has_nominatim_details") || !osmType || !osmId) { setPlaceDetails(null); return }
    const controller = new AbortController()
    setPlaceDetails("loading")
    fetchPlaceDetails(osmType, osmId, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setPlaceDetails(data || null)
        if (data?.boundary) {
          const current = useStore.getState().selectedPlace
          if (current && current.lat === placeLat && current.lon === placeLon) {
            useStore.getState().setSelectedPlace({ ...current, boundary: data.boundary })
          }
        }
      }
    })
    return () => controller.abort()
  }, [osmType, osmId, placeLat, placeLon])

  useEffect(() => {
    if (osmType && osmId) return
    if (!wikidataId) return
    const controller = new AbortController()
    fetchPlaceByWikidata(wikidataId, controller.signal).then((data) => {
      if (!controller.signal.aborted && data) {
        setPlaceDetails((prev) => ({
          ...(prev === "loading" ? {} : prev || {}),
          description: data.description,
          population: data.population,
          osm_relation_id: data.osm_relation_id,
          extratags: { ...(prev && prev !== "loading" ? prev.extratags : {}), ...data.extratags },
        }))
        if (data?.boundary) {
          const current = useStore.getState().selectedPlace
          if (current && current.lat === placeLat && current.lon === placeLon) {
            useStore.getState().setSelectedPlace({ ...current, boundary: data.boundary })
          }
        }
      }
    })
    return () => controller.abort()
  }, [wikidataId, osmType, osmId, placeLat, placeLon])

  useEffect(() => {
    if (variant !== "preview" || !userLocation || placeLat == null || placeLon == null) { setDriveTime(null); return }
    setDriveTime(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    fetchDriveTime(userLocation.lat, userLocation.lon, placeLat, placeLon, controller.signal).then((time) => { if (!controller.signal.aborted) setDriveTime(time) })
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [variant, userLocation?.lat, userLocation?.lon, placeLat, placeLon])

  useEffect(() => {
    if (!hasFeature("has_contacts") || !auth.authenticated || placeLat == null || placeLon == null) { setNearbyLabel(null); return }
    const controller = new AbortController()
    fetchNearbyContacts(placeLat, placeLon, 75, controller.signal).then((nearby) => {
      if (!controller.signal.aborted && nearby.length > 0) setNearbyLabel(nearby[0].label)
      else if (!controller.signal.aborted) setNearbyLabel(null)
    })
    return () => controller.abort()
  }, [placeLat, placeLon])

  useEffect(() => {
    if (!hasFeature("has_landclass") || placeLat == null || placeLon == null) { setLandclass(null); return }
    const controller = new AbortController()
    fetchLandclass(placeLat, placeLon, controller.signal).then((data) => {
      if (!controller.signal.aborted && data) {
        setLandclass(data)
        if (data.summary && useStore.getState().selectedPlace?.name === "Dropped pin") {
          const current = useStore.getState().selectedPlace
          useStore.getState().setSelectedPlace({ ...current, name: data.summary })
        }
      } else if (!controller.signal.aborted) setLandclass(null)
    })
    return () => controller.abort()
  }, [placeLat, placeLon])

  if (!place) return null

  const address = buildAddress(place)
  const elevLoading = placeLat != null && (elevResult.lat !== placeLat || elevResult.lon !== placeLon)
  const elevation = !elevLoading ? elevResult.value : null
  const elevFeet = elevation != null ? Math.round(elevation * M_TO_FT) : null
  const existingStopIndex = stops.findIndex((s) => s.lat === place.lat && s.lon === place.lon)
  const savedContact = contacts.find((c) => c.lat === place.lat && c.lon === place.lon)

  const handleDirections = () => {
    // No toast - empty origin slot is the visual prompt
    startDirections(place)
  }
  const handleAddStop = () => {
    addStop({ lat: place.lat, lon: place.lon, name: place.name, source: place.source, matchCode: place.matchCode })
    clearSelectedPlace()
  }
  const handleSave = () => {
    if (!hasFeature("has_contacts")) { toast("Saved places coming soon"); return }
    if (savedContact) setEditingContact(savedContact)
    else setEditingContact({ label: "", lat: place.lat, lon: place.lon, osm_type: osmType || null, osm_id: osmId || null, address: address || "", name: place.type === "poi" && place.raw?.name ? place.raw.name : "" })
  }
  const closeCopy = useCallback(() => setCopyOpen(false), [])
  const stopLetter = stopIndex != null ? String.fromCharCode(65 + stopIndex) : null

  if (!expanded) {
    return (
      <div className="navi-place-card navi-place-card-collapsed flex items-center gap-2 p-2 rounded-lg cursor-pointer" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }} onClick={onToggleExpand}>
        {draggable && <div {...dragHandleProps} className="cursor-grab" style={{ color: "var(--text-tertiary)" }}><GripVertical size={14} /></div>}
        {stopLetter && <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>{stopLetter}</div>}
        <span className="flex-1 text-sm truncate" style={{ color: "var(--text-primary)" }}>{(place.raw?.name || place.name) || "Unknown place"}</span>
        <ChevronDown size={14} style={{ color: "var(--text-tertiary)" }} />
        {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove() }} className="p-1 rounded hover:opacity-80" style={{ color: "var(--text-tertiary)" }}><X size={14} /></button>}
      </div>
    )
  }

  return (
    <div className="navi-place-card navi-place-card-expanded flex flex-col rounded-lg p-3" style={{ background: "var(--bg-inset)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {draggable && <div {...dragHandleProps} className="cursor-grab mt-0.5" style={{ color: "var(--text-tertiary)" }}><GripVertical size={14} /></div>}
          {stopLetter && <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>{stopLetter}</div>}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{(place.raw?.name || place.name) || "Unknown place"}</span>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {place.type && !["poi", "unknown", ""].includes(place.type.toLowerCase()) && <span className="capitalize">{place.type}</span>}
              {driveTime != null && <><span>{"\u00b7"}</span><span>{formatDriveTime(driveTime)} drive</span></>}
              {nearbyLabel && <><span>{"\u00b7"}</span><span>Near {nearbyLabel}</span></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleExpand && variant === "stop" && <button onClick={onToggleExpand} className="p-1 rounded hover:opacity-80" style={{ color: "var(--text-tertiary)" }}><ChevronUp size={14} /></button>}
          {onClose && <button onClick={onClose} className="p-1 rounded hover:opacity-80" style={{ color: "var(--text-tertiary)" }}><X size={14} /></button>}
        </div>
      </div>
      {address && <div className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>{address}</div>}
      <div className="flex items-center text-xs mb-2" style={{ color: "var(--text-tertiary)" }}>
        <span>{place.lat.toFixed(6)}, {place.lon.toFixed(6)}</span>
        <span className="mx-2">{"\u00b7"}</span>
        <span>{elevLoading ? "..." : elevFeet != null ? elevFeet.toLocaleString() + " ft" : "\u2014"}</span>
      </div>
      <LandclassSection data={landclass} />
      <PrivateLandIndicator data={landclass} />
      {placeDetails === "loading" && <EnrichmentSkeleton />}
      {placeDetails && placeDetails !== "loading" && <EnrichmentSections details={placeDetails} />}
      <div className="mt-3 pt-3 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
        {variant === "preview" && (
          <>
            {stops.length < 2 && <button onClick={handleDirections} className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}><Navigation size={13} />Directions</button>}
            {existingStopIndex >= 0 ? (
              <span className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium" style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>Stop {String.fromCharCode(65 + existingStopIndex)}</span>
            ) : (
              <button onClick={handleAddStop} className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium" style={{ background: "var(--tan-muted)", color: "var(--tan)", border: "1px solid var(--border)" }}><Plus size={13} />Add stop</button>
            )}
          </>
        )}
        {variant === "stop" && onRemove && <button onClick={onRemove} className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium" style={{ background: "var(--tan-muted)", color: "var(--tan)", border: "1px solid var(--border)" }}><X size={13} />Remove</button>}
        {auth.authenticated ? (
          <button onClick={handleSave} className="p-2 rounded-lg" style={{ background: savedContact ? "var(--accent-muted)" : "var(--tan-muted)", color: savedContact ? "var(--accent)" : "var(--tan)", border: "1px solid var(--border)" }} aria-label={savedContact ? "Edit saved contact" : "Save place"}><Bookmark size={14} fill={savedContact ? "currentColor" : "none"} /></button>
        ) : (
          <button onClick={() => { window.location.href = "/outpost.goauthentik.io/start?rd=%2F" }} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs" style={{ background: "var(--accent-muted)", color: "var(--accent)", border: "1px solid var(--border)" }} title="Log in to save places"><LogIn size={12} /><span>Save</span></button>
        )}
        <div className="relative">
          <button onClick={() => setCopyOpen((v) => !v)} className="p-2 rounded-lg flex items-center gap-0.5" style={{ background: "var(--tan-muted)", color: "var(--tan)", border: "1px solid var(--border)" }} aria-label="Copy"><Copy size={14} /><ChevronDown size={10} /></button>
          {copyOpen && <CopyPopover address={address} place={place} onClose={closeCopy} />}
        </div>
      </div>
    </div>
  )
}

export default PlaceCard
