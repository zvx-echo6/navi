# Navi Feature Ideas

Planned features and enhancements for the Navi navigation platform.

---

## Traffic & Incident Intelligence

### Traffic-Aware Routing

**Status:** Planned (post-Phase O3)

Integrate TomTom traffic data into Valhalla routing calculations:

- TomTom traffic tiles already available at `/api/traffic/*` (visual overlay)
- Configure Valhalla `traffic_tile_dir` to consume speed data
- Routes will account for live congestion on segments 2–4 of offroute chain
- Does not affect wilderness pathfinder (segment 1)

### Idaho 511 Incident Feed

**Status:** Planned (post-Phase O3)

Real-time road closure and incident integration:

- Poll Idaho 511 API every 5–10 minutes
- Store active incidents in `navi.db` with auto-expiration
- Display incidents as map overlay (icons/markers)
- Feed closures to Valhalla as `avoid_locations` for routing
- Stretch: support other state 511 feeds for cross-state trips

---

## Tracking & Situational Awareness

### ADS-B Aircraft Tracking

**Status:** Planned

Display live aircraft positions from ADS-B receivers:

- Integrate with local ADS-B receiver (dump1090/readsb)
- Show aircraft positions, altitude, callsign on map
- Useful for backcountry SAR coordination and general aviation awareness

### AIS Vessel Tracking

**Status:** Planned

Display marine vessel positions:

- Integrate with AIS receiver or feed
- Show vessel positions, heading, name on map
- Applicable for coastal/maritime navigation scenarios

---

## TAK Integration

### TAK Server + EUD Integration

**Status:** Planned

Connect Navi to the TAK ecosystem (ATAK, iTAK, WinTAK):

- TAK Server integration for shared situational awareness
- Push Navi routes to TAK clients as CoT (Cursor on Target)
- Pull team member positions from TAK into Navi
- Enable SAR/field team coordination through unified COP

---

## Mobile & Offline

### Native iOS App

**Status:** Planned

Native iOS application for offline-first navigation:

- Full offline map tile access
- Offline routing with pre-cached Valhalla tiles
- Integration with Apple Watch for turn-by-turn
- Meshtastic/LoRa mesh network support for off-grid comms

---

## Notes

- Features above Phase O3 depend on core offroute functionality being complete
- Traffic and 511 features can be built in parallel
- TAK integration useful for field coordination but not blocking core nav
