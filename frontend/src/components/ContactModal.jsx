import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Trash2, MapPin, Crosshair } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { createContact, updateContact, deleteContact, fetchContacts, fetchReverse, searchGeocode } from '../api'

const CATEGORIES = ['family', 'friend', 'business', 'emergency', 'ham', 'bug-out', 'favorite']

export default function ContactModal() {
  const editingContact = useStore((s) => s.editingContact)
  const clearEditingContact = useStore((s) => s.clearEditingContact)
  const setPickingLocationFor = useStore((s) => s.setPickingLocationFor)
  const setContacts = useStore((s) => s.setContacts)

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  // Geocode search state
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editingContact) {
      setForm({
        id: editingContact.id,
        label: editingContact.label || '',
        name: editingContact.name || '',
        call_sign: editingContact.call_sign || '',
        phone: editingContact.phone || '',
        email: editingContact.email || '',
        category: editingContact.category || '',
        notes: editingContact.notes || '',
        show_proximity: editingContact.show_proximity || false,
        lat: editingContact.lat ?? null,
        lon: editingContact.lon ?? null,
        osm_type: editingContact.osm_type || null,
        osm_id: editingContact.osm_id || null,
        address: editingContact.address || '',
      })
      setSearchResults([])
      setShowDropdown(false)
    }
  }, [editingContact])

  // Auto-populate address from reverse geocode when lat/lon exist but address is empty
  useEffect(() => {
    if (!editingContact) return
    const hasGeo = form.lat != null && form.lon != null
    const addressEmpty = !form.address || form.address.trim() === ''
    if (hasGeo && addressEmpty) {
      let cancelled = false
      fetchReverse(form.lat, form.lon).then((place) => {
        if (!cancelled && place) {
          const addr = place.address || place.name || ''
          if (addr) {
            setForm((f) => ({ ...f, address: addr }))
          }
        }
      })
      return () => { cancelled = true }
    }
  }, [editingContact, form.lat, form.lon])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const close = useCallback(() => clearEditingContact(), [clearEditingContact])

  useEffect(() => {
    if (!editingContact) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showDropdown) {
          setShowDropdown(false)
        } else {
          close()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editingContact, close, showDropdown])

  if (!editingContact) return null

  const isEdit = editingContact.id != null
  const hasGeo = form.lat != null && form.lon != null

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  // Handle address input change with debounced geocode search
  const handleAddressChange = (e) => {
    const query = e.target.value
    setField('address', query)

    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query || query.length < 3) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await searchGeocode(query, 5)
        setSearchResults(results || [])
        setShowDropdown(true)
      } catch (err) {
        console.error('Geocode search error:', err)
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }

  // Handle selecting a geocode result
  const handleSelectResult = (result) => {
    setForm((f) => ({
      ...f,
      address: result.display_name || result.name || '',
      lat: result.lat,
      lon: result.lon,
      osm_type: result.osm_type || null,
      osm_id: result.osm_id || null,
    }))
    setShowDropdown(false)
    setSearchResults([])
  }

  // Handle "Set on map" button
  const handleSetOnMap = () => {
    // Save current form state to store for map pick mode
    setPickingLocationFor({ ...form })
    clearEditingContact()
    toast('Click the map to set location', { icon: '📍', duration: 3000 })
  }

  const refreshContacts = async () => {
    const data = await fetchContacts()
    if (!data?.auth && Array.isArray(data)) setContacts(data)
    else if (Array.isArray(data)) setContacts(data)
  }

  const handleSave = async () => {
    if (!form.label?.trim()) {
      toast.error('Label is required')
      return
    }
    setSaving(true)
    try {
      const payload = { ...form, label: form.label.trim() }
      delete payload.id // Don't send id in payload
      if (payload.show_proximity === false) payload.show_proximity = false
      const result = isEdit
        ? await updateContact(editingContact.id, payload)
        : await createContact(payload)
      if (result?.auth === false) {
        toast.error('Sign in to save contacts')
        setSaving(false)
        return
      }
      if (result?._status === 409 || result?.error?.includes('Home/Work')) {
        toast.error('You already have a Home/Work contact')
        setSaving(false)
        return
      }
      toast.success(isEdit ? 'Contact updated' : 'Contact saved')
      await refreshContacts()
      close()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this contact? You can restore it from the dashboard.')) return
    setSaving(true)
    try {
      await deleteContact(editingContact.id)
      toast('Contact deleted')
      await refreshContacts()
      close()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // Format result for display
  const formatResult = (r) => {
    const parts = []
    if (r.name) parts.push(r.name)
    if (r.address?.city) parts.push(r.address.city)
    if (r.address?.state) parts.push(r.address.state)
    return parts.length > 0 ? parts.join(', ') : r.display_name || 'Unknown location'
  }

  return (
    <div className="contact-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="contact-modal">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-md font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Contact' : 'Save Contact'}
          </h3>
          <button onClick={close} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Label with quick-fill */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Label *</label>
          <div className="flex gap-2 mb-1.5">
            {['Home', 'Work'].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setField('label', l)}
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  background: form.label === l ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                  color: form.label === l ? 'var(--accent)' : 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <input
            className="navi-input w-full"
            value={form.label}
            onChange={(e) => setField('label', e.target.value)}
            placeholder="e.g. Home, Work, Mom, Bug Out"
          />
        </div>

        {/* Address with geocode search */}
        <div className="mb-3 relative">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Address</label>
          <input
            ref={inputRef}
            className="navi-input w-full"
            value={form.address}
            onChange={handleAddressChange}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder="Type to search or enter address..."
          />
          {searchLoading && (
            <div className="absolute right-2 top-7 text-xs" style={{ color: 'var(--text-tertiary)' }}>...</div>
          )}
          {/* Dropdown results */}
          {showDropdown && searchResults.length > 0 && (
            <div
              className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-50"
              style={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-lg)',
                maxHeight: '200px',
                overflowY: 'auto',
              }}
            >
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:opacity-80"
                  style={{
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    borderBottom: i < searchResults.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                  onMouseDown={() => handleSelectResult(r)}
                >
                  <div className="truncate">{formatResult(r)}</div>
                  {r.display_name && r.display_name !== formatResult(r) && (
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {r.display_name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Location display + Set on map button */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Location</label>
          <div className="flex items-center gap-2">
            {hasGeo ? (
              <div className="flex items-center gap-2 text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
                <MapPin size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span>{form.lat.toFixed(6)}, {form.lon.toFixed(6)}</span>
              </div>
            ) : (
              <div className="text-xs flex-1" style={{ color: 'var(--text-tertiary)' }}>
                No location set
              </div>
            )}
            <button
              type="button"
              onClick={handleSetOnMap}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              style={{
                background: 'var(--bg-overlay)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Crosshair size={12} />
              Set on map
            </button>
          </div>
        </div>

        {/* Category */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Category</label>
          <input
            className="navi-input w-full"
            list="contact-categories"
            value={form.category}
            onChange={(e) => setField('category', e.target.value)}
            placeholder="family, friend, emergency..."
          />
          <datalist id="contact-categories">
            {CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* Name + Call Sign */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Name</label>
            <input className="navi-input w-full" value={form.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div className="w-24">
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Call Sign</label>
            <input className="navi-input w-full" value={form.call_sign} onChange={(e) => setField('call_sign', e.target.value)} />
          </div>
        </div>

        {/* Phone + Email */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Phone</label>
            <input className="navi-input w-full" value={form.phone} onChange={(e) => setField('phone', e.target.value)} type="tel" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Email</label>
            <input className="navi-input w-full" value={form.email} onChange={(e) => setField('email', e.target.value)} type="email" />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Notes</label>
          <textarea
            className="navi-input w-full"
            rows={2}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>

        {/* Show proximity */}
        <label className="flex items-center gap-2 mb-3 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.show_proximity}
            onChange={(e) => setField('show_proximity', e.target.checked)}
            className="layer-control-toggle"
          />
          Show "near {form.label || '...'}" on nearby places
        </label>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 px-3 rounded-lg text-xs font-medium"
            style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Save'}
          </button>
          {isEdit && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="p-2 rounded-lg"
              style={{ background: 'var(--tan-muted)', color: 'var(--status-danger)', border: '1px solid var(--border)' }}
              title="Delete contact"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
