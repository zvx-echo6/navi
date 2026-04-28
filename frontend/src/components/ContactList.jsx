import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, MapPin, User, Phone, Radio, LogIn, MoreVertical, Navigation, Eye, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import { fetchContacts, deleteContact } from '../api'

export default function ContactList() {
  const contacts = useStore((s) => s.contacts)
  const contactsLoaded = useStore((s) => s.contactsLoaded)
  const setContacts = useStore((s) => s.setContacts)
  const setEditingContact = useStore((s) => s.setEditingContact)
  const setSelectedPlace = useStore((s) => s.setSelectedPlace)
  const setClickMarker = useStore((s) => s.setClickMarker)
  const startDirections = useStore((s) => s.startDirections)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const auth = useStore((s) => s.auth)

  const [filter, setFilter] = useState('')
  const [menuOpen, setMenuOpen] = useState(null) // contact id or null
  const menuRef = useRef(null)

  const loadContacts = useCallback(async () => {
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

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(null)
      }
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  // Show login prompt if not authenticated
  if (auth.loaded && !auth.authenticated) {
    return (
      <div className="mt-6 text-center">
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Sign in to save and sync your contacts
        </p>
        <button
          onClick={() => { window.location.href = '/outpost.goauthentik.io/start?rd=%2F' }}
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

  const handleMenuClick = (e, contactId) => {
    e.stopPropagation()
    setMenuOpen(menuOpen === contactId ? null : contactId)
  }

  const handleDirections = (c) => {
    setMenuOpen(null)
    startDirections({ lat: c.lat, lon: c.lon, name: c.label })
  }

  const handleViewOnMap = (c) => {
    setMenuOpen(null)
    // Set click marker at location
    setClickMarker({ lat: c.lat, lon: c.lon })
    // Set selected place to trigger map fly and place card
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
    // Switch to routes tab to close contacts panel
    setActiveTab('routes')
  }

  const handleEdit = (c) => {
    setMenuOpen(null)
    setEditingContact(c)
  }

  const handleDelete = async (c) => {
    setMenuOpen(null)
    if (!confirm(`Delete "${c.label}"? You can restore it from the dashboard.`)) return
    try {
      const result = await deleteContact(c.id)
      if (result?.auth === false) {
        toast.error('Sign in to delete contacts')
        return
      }
      toast.success('Contact deleted')
      await loadContacts()
    } catch (e) {
      toast.error(e.message)
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
          {filtered.map((c) => {
            const hasLocation = c.lat != null && c.lon != null
            const isMenuOpen = menuOpen === c.id

            return (
              <div
                key={c.id}
                className="contact-item relative"
                onClick={() => handleClick(c)}
              >
                <span className="shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {hasLocation ? <MapPin size={14} /> : c.call_sign ? <Radio size={14} /> : <User size={14} />}
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
                {c.show_proximity && hasLocation && (
                  <span
                    className="text-[9px] px-1 py-0.5 rounded shrink-0"
                    style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                  >
                    prox
                  </span>
                )}

                {/* Three-dot menu button */}
                <button
                  onClick={(e) => handleMenuClick(e, c.id)}
                  className="shrink-0 p-1 rounded hover:bg-[var(--bg-overlay)]"
                  style={{ color: 'var(--text-tertiary)' }}
                  title="Actions"
                >
                  <MoreVertical size={14} />
                </button>

                {/* Dropdown menu */}
                {isMenuOpen && (
                  <div
                    ref={menuRef}
                    className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden"
                    style={{
                      background: 'var(--bg-raised)',
                      border: '1px solid var(--border)',
                      boxShadow: 'var(--shadow-lg)',
                      minWidth: '140px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {hasLocation && (
                      <>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-overlay)]"
                          style={{ color: 'var(--text-primary)' }}
                          onClick={() => handleDirections(c)}
                        >
                          <Navigation size={12} />
                          Directions to
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-overlay)]"
                          style={{ color: 'var(--text-primary)' }}
                          onClick={() => handleViewOnMap(c)}
                        >
                          <Eye size={12} />
                          View on map
                        </button>
                      </>
                    )}
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-overlay)]"
                      style={{ color: 'var(--text-primary)' }}
                      onClick={() => handleEdit(c)}
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--bg-overlay)]"
                      style={{ color: 'var(--status-danger)' }}
                      onClick={() => handleDelete(c)}
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
