import { useEffect, useState, useCallback } from 'react'
import { Plus, MapPin, User, Phone, Radio, LogIn } from 'lucide-react'
import { useStore } from '../store'
import { fetchContacts } from '../api'

export default function ContactList() {
  const contacts = useStore((s) => s.contacts)
  const contactsLoaded = useStore((s) => s.contactsLoaded)
  const setContacts = useStore((s) => s.setContacts)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const setSelectedPlace = useStore((s) => s.setSelectedPlace)
  const auth = useStore((s) => s.auth)

  const [filter, setFilter] = useState('')

  const loadContacts = useCallback(async () => {
    // Skip fetch entirely if not authenticated
    if (!auth.authenticated) return
    const data = await fetchContacts()
    if (Array.isArray(data)) {
      setContacts(data)
    }
  }, [setContacts, auth.authenticated])

  useEffect(() => {
    if (auth.loaded && auth.authenticated && !contactsLoaded) {
      loadContacts()
    }
  }, [auth.loaded, auth.authenticated, contactsLoaded, loadContacts])

  // Show login prompt if not authenticated
  if (auth.loaded && !auth.authenticated) {
    return (
      <div className="mt-6 text-center">
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Sign in to save and sync your contacts
        </p>
        <button
          onClick={() => { window.location.href = '/api/auth/whoami' }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
        >
          <LogIn size={12} />
          Log in
        </button>
      </div>
    )
  }

  const q = filter.toLowerCase()
  const filtered = q
    ? contacts.filter((c) =>
        (c.label || '').toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.call_sign || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      )
    : contacts

  const handleClick = (c) => {
    if (c.lat != null && c.lon != null) {
      setSelectedPlace({
        lat: c.lat,
        lon: c.lon,
        name: c.label,
        address: c.address || null,
        type: 'contact',
        source: 'contacts',
        matchCode: null,
        raw: { osm_type: c.osm_type, osm_id: c.osm_id, contact: c },
      })
    } else {
      setEditingContact(c)
    }
  }

  return (
    <div className="mt-2">
      {/* Search + add */}
      <div className="flex gap-2 mb-2">
        <input
          className="navi-input flex-1"
          placeholder="Filter contacts..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          onClick={() => setEditingContact({})}
          className="p-2 rounded-lg shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}
          title="New contact"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="mt-4 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {contacts.length === 0 ? 'No contacts yet' : 'No matches'}
        </div>
      ) : (
        <div className="flex flex-col">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="contact-item"
              onClick={() => handleClick(c)}
            >
              <span className="shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                {c.lat != null ? <MapPin size={14} /> : c.call_sign ? <Radio size={14} /> : <User size={14} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{c.label}</div>
                <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {c.name || c.address || c.phone || ''}
                </div>
              </div>
              {c.phone && (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  <Phone size={10} />
                </span>
              )}
              {c.show_proximity && c.lat != null && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded shrink-0"
                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                >
                  prox
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
