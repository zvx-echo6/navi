import { useState, useEffect, useRef } from 'react'
import { Layers, Trees, Mountain } from 'lucide-react'
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
  const [publicLands, setPublicLands] = useState(false)
  const [contours, setContours] = useState(false)
  const panelRef = useRef(null)

  // Initialize from localStorage or defaults on mount
  useEffect(() => {
    const saved = loadPrefs()
    const hsAvailable = hasFeature('has_hillshade')
    const trAvailable = hasFeature('has_traffic_overlay')

    const plAvailable = hasFeature('has_public_lands_layer')
    const ctAvailable = hasFeature('has_contours')

    if (saved) {
      setHillshade(hsAvailable && (saved.hillshade ?? true))
      setTraffic(trAvailable && (saved.traffic ?? false))
      setPublicLands(plAvailable && (saved.publicLands ?? false))
      setContours(ctAvailable && (saved.contours ?? false))
    } else {
      // Defaults: hillshade ON if available, others OFF
      setHillshade(hsAvailable)
      setTraffic(false)
      setPublicLands(false)
      setContours(false)
    }
  }, [])

  // Apply layers when prefs change
  useEffect(() => {
    const mapView = mapRef?.current
    if (!mapView) return
    const map = mapView.getMap?.()
    if (!map) return

    const apply = () => {
      if (hillshade && hasFeature('has_hillshade')) {
        mapView.addHillshadeLayer?.()
      } else {
        mapView.removeHillshadeLayer?.()
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
    }
    savePrefs({ hillshade, traffic, publicLands, contours })
    return () => map.off('style.load', apply)
  }, [hillshade, mapRef])

  useEffect(() => {
    const mapView = mapRef?.current
    if (!mapView) return
    const map = mapView.getMap?.()
    if (!map) return

    const apply = () => {
      if (traffic && hasFeature('has_traffic_overlay')) {
        mapView.addTrafficLayer?.()
      } else {
        mapView.removeTrafficLayer?.()
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
    }
    savePrefs({ hillshade, traffic, publicLands, contours })
    return () => map.off('style.load', apply)
  }, [traffic, mapRef])

  useEffect(() => {
    const mapView = mapRef?.current
    if (!mapView) return
    const map = mapView.getMap?.()
    if (!map) return

    const apply = () => {
      if (publicLands && hasFeature('has_public_lands_layer')) {
        mapView.addPublicLandsLayer?.()
      } else {
        mapView.removePublicLandsLayer?.()
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
    }
    savePrefs({ hillshade, traffic, publicLands, contours })
    return () => map.off('style.load', apply)
  }, [publicLands, mapRef])

  useEffect(() => {
    const mapView = mapRef?.current
    if (!mapView) return
    const map = mapView.getMap?.()
    if (!map) return

    const apply = () => {
      if (contours && hasFeature('has_contours')) {
        mapView.addContoursLayer?.()
      } else {
        mapView.removeContoursLayer?.()
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('style.load', apply)
    }
    savePrefs({ hillshade, traffic, publicLands, contours })
    return () => map.off('style.load', apply)
  }, [contours, mapRef])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClick)
    return () => document.removeEventListener('pointerdown', handleClick)
  }, [open])

  const showHillshade = hasFeature('has_hillshade')
  const showTraffic = hasFeature('has_traffic_overlay')
  const showPublicLands = hasFeature('has_public_lands_layer')
  const showContours = hasFeature('has_contours')

  // Don't render if no overlay features available
  if (!showHillshade && !showTraffic && !showPublicLands && !showContours) return null

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

          {showPublicLands && (
            <label className="layer-control-item">
              <span className="layer-control-label">Public Lands</span>
              <input
                type="checkbox"
                className="layer-control-toggle"
                checked={publicLands}
                onChange={(e) => setPublicLands(e.target.checked)}
              />
            </label>
          )}

          {showContours && (
            <label className="layer-control-item">
              <span className="layer-control-label">Contours</span>
              <input
                type="checkbox"
                className="layer-control-toggle"
                checked={contours}
                onChange={(e) => setContours(e.target.checked)}
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
