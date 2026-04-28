import { useState, useEffect, useCallback } from 'react'
import { X, Trash2, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { createContact, updateContact, deleteContact, fetchContacts, fetchReverse } from '../api'

const CATEGORIES = ['family', 'friend', 'business', 'emergency', 'ham', 'bug-out', 'favorite']

export default function ContactModal() {
  const editingContact = useStore((s) => s.editingContact)
  const clearEditingContact = useStore((s) => s.clearEditingContact)
  const setContacts = useStore((s) => s.setContacts)

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingContact) {
      setForm({
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

  const close = useCallback(() => clearEditingContact(), [clearEditingContact])

  useEffect(() => {
    if (!editingContact) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editingContact, close])

  if (!editingContact) return null

  const isEdit = editingContact.id != null
  const hasGeo = form.lat != null && form.lon != null

  const setField = (key, val) => setForm((f) => ({ ...f, [key]: val }))

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

        {/* Address */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Address</label>
          <input
            className="navi-input w-full"
            value={form.address}
            onChange={(e) => setField('address', e.target.value)}
            placeholder="Street address, city, state..."
          />
        </div>

        {/* Location */}
        <div className="mb-3">
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Location</label>
          {hasGeo ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-primary)' }}>
              <MapPin size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>{form.lat.toFixed(6)}, {form.lon.toFixed(6)}</span>
            </div>
          ) : (
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No location — save from a place card to attach coordinates
            </div>
          )}
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
