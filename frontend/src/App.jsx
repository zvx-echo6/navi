import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedTheme } from 'protomaps-themes-base'

export default function App() {
  const mapContainer = useRef(null)

  useEffect(() => {
    const protocol = new Protocol()
    maplibregl.addProtocol('pmtiles', protocol.tile)

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/dark',
        sources: {
          protomaps: {
            type: 'vector',
            url: 'pmtiles:///tiles/idaho.pmtiles',
            attribution: '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
          },
        },
        layers: layers('protomaps', namedTheme('dark'), { lang: 'en' }),
      },
      center: [-114.5, 44.0],
      zoom: 6,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    return () => {
      maplibregl.removeProtocol('pmtiles')
      map.remove()
    }
  }, [])

  return <div ref={mapContainer} className="w-screen h-screen" />
}
