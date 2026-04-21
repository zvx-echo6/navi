import { useState, useEffect, useRef } from 'react'
import { Layers } from 'lucide-react'
import { hasFeature, getConfig } from '../config'

const STORAGE_KEY = 'navi-layer-prefs'

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function savePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export default function LayerControl({ mapRef }) {
  const [open, setOpen] = useState(false)
  const [hillshade, setHillshade] = useState(false)
  const [traffic, setTraffic] = useState(false)
  const panelRef = useRef(null)

  // Initialize from localStorage or defaults on mount
  useEffect(() => {
    const saved = loadPrefs()
    const hsAvailable = hasFeature('has_hillshade')
    const trAvailable = hasFeature('has_traffic_overlay')

    if (saved) {
      setHillshade(hsAvailable && (saved.hillshade ?? true))
      setTraffic(trAvailable && (saved.traffic ?? false))
    } else {
      // Defaults: hillshade ON if available, traffic OFF
      setHillshade(hsAvailable)
      setTraffic(false)
    }
  }, [])

  // Apply layers when prefs change
  useEffect(() => {
    const map = mapRef?.current?.getMap?.()
    if (!map || !map.isStyleLoaded()) return

    if (hillshade && hasFeature('has_hillshade')) {
      mapRef.current.addHillshadeLayer?.()
    } else {
      mapRef.current.removeHillshadeLayer?.()
    }
    savePrefs({ hillshade, traffic })
  }, [hillshade, mapRef])

  useEffect(() => {
    const map = mapRef?.current?.getMap?.()
    if (!map || !map.isStyleLoaded()) return

    if (traffic && hasFeature('has_traffic_overlay')) {
      mapRef.current.addTrafficLayer?.()
    } else {
      mapRef.current.removeTrafficLayer?.()
    }
    savePrefs({ hillshade, traffic })
  }, [traffic, mapRef])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const showHillshade = hasFeature('has_hillshade')
  const showTraffic = hasFeature('has_traffic_overlay')

  // Don't render if no overlay features available
  if (!showHillshade && !showTraffic) return null

  return (
    <div ref={panelRef} className="layer-control">
      <button
        className="layer-control-btn"
        onClick={() => setOpen((v) => !v)}
        title="Map layers"
        aria-label="Toggle map layers"
      >
        <Layers size={18} />
      </button>

      {open && (
        <div className="layer-control-popover">
          <div className="layer-control-header">Layers</div>

          {showHillshade && (
            <label className="layer-control-item">
              <span className="layer-control-label">Hillshade</span>
              <input
                type="checkbox"
                className="layer-control-toggle"
                checked={hillshade}
                onChange={(e) => setHillshade(e.target.checked)}
              />
            </label>
          )}

          {showTraffic && (
            <label className="layer-control-item">
              <span className="layer-control-label">Traffic</span>
              <input
                type="checkbox"
                className="layer-control-toggle"
                checked={traffic}
                onChange={(e) => setTraffic(e.target.checked)}
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
