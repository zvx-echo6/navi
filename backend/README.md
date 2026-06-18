# navi-backend

Full monorepo for the Navi backend and frontend, extracted from the `recon`
codebase as part of the **recon <=> Navi decoupling** project.

`backend/` contains 8 single-responsibility microservices that together own the
`/api/*` surface that `navi.echo6.co` depends on; `frontend/` is the Vite SPA.
All backend services run behind the existing Caddy/Authentik edge.

**Note:** `navi-traffic` (the original extraction #1 — TomTom traffic tile proxy)
has been **retired**. Traffic data is now served by the `central` service
(central.echo6.mesh).

## Services

| # | Service | Port | Description |
|---|---------|------|-------------|
| 1 | navi-traffic | — | **DISABLED** — retired, traffic now via central |
| 2 | navi-config | 8422 | Configuration store |
| 3 | navi-contacts | 8423 | Contacts / address book |
| 4 | navi-landclass | 8424 | Land classification lookup |
| 5 | navi-places | 8425 | Places / POI search |
| 6 | navi-geo | 8426 | Geocoding, reverse geocoding, enrichment bundle |
| 7 | navi-admin | 8427 | Fleet admin front door (fan-out to all services) |
| 8 | navi-offroute | 8428 | Off-road / off-network routing |

## Layout

```
navi-mono/
├── backend/
│   ├── shared/                  # cross-service helpers, imported by every service
│   │   ├── auth.py              # get_user_id(req), require_auth decorator (Authentik header)
│   │   └── admin_info.py        # build_info_response(), mask_key(), time_dependency()
│   └── services/
│       ├── navi_config/         # :8422
│       ├── navi_contacts/       # :8423
│       ├── navi_landclass/      # :8424
│       ├── navi_places/         # :8425
│       ├── navi_geo/            # :8426
│       ├── navi_admin/          # :8427
│       └── navi_offroute/       # :8428
└── frontend/                    # Vite SPA
```

Service directories use an underscore (`navi_geo`) so they are importable
Python packages; the **service name** stays hyphenated (`navi-geo`) in systemd,
nginx, and the admin-info `service` field.

## Setup

Single workspace, single virtualenv:

```bash
python -m venv .venv
.venv/bin/pip install -e .
```

## Test

```bash
.venv/bin/pytest services/navi_geo/tests/ -v
```

## Run (local) — navi-geo (extraction #6)

```bash
.venv/bin/pytest services/navi_geo/tests/ -v

# All paths/URLs are env-overridable (see deploy/env/navi-geo.env.example).
# No secrets — landclass is HTTP-delegated to navi-landclass (:8424).
.venv/bin/gunicorn 'services.navi_geo.app:create_app()' \
    --bind 127.0.0.1:8426 --workers 2
```

`navi-geo` serves `/api/geocode`, `/api/reverse?lat=&lon=`, and the reverse
enrichment bundle `/api/reverse/<lat>/<lon>` (Central's 9-key contract). All
public. The reverse bundle fans out to Photon, the SpatiaLite timezone DB,
navi-landclass (HTTP), and the planet-DEM PMTiles — each degrading to `null`
independently, never 5xx.

## Run (local) — navi-admin (extraction #7)

```bash
.venv/bin/pytest services/navi_admin/tests/ -v

# No secrets — read-only HTTP fan-out over localhost (see
# deploy/env/navi-admin.env.example). Owns no DB.
.venv/bin/gunicorn 'services.navi_admin.app:create_app()' \
    --bind 127.0.0.1:8427 --workers 2
```

`navi-admin` is the fleet admin front door: `/api/admin/fleet` fans out to every
navi-* service's localhost `/api/admin/<svc>/info` + recon's `/api/health`
(merged, never 5xx — failures land in `errors[]`); `/api/admin/recon/info` wraps
recon's health into the uniform shape; `/api/admin/navi-admin/info` self-describes.
All `@require_auth`. The per-service admin endpoints stay localhost-only; this is
the single edge-exposed admin surface (needs a Caddy `@authed_api` edit — see
`deploy/caddy/navi-admin.caddy.notes.md`).

## Run (local) — navi-offroute (extraction #8)

```bash
.venv/bin/pytest services/navi_offroute/tests/ -v

# All paths/URLs env-overridable (deploy/env/navi-offroute.env.example).
# No secrets — PADUS via libpq peer-auth (dbname=padus). DEM via shared/dem.py.
# Needs osmium-tool on the host + scikit-image/rasterio in the venv.
.venv/bin/gunicorn 'services.navi_offroute.app:create_app()' \
    --bind 127.0.0.1:8428 --workers 2 --timeout 130
```

`navi-offroute` serves `POST /api/offroute` (off-network effort-based routing —
in-Python least-cost path over a DEM/friction/barriers/trails/MVUM cost grid,
stitched to the road network via Valhalla) and `GET /api/mvum` (Motor Vehicle
Use Map road/trail access lookup). Both public. The `^~ /api/offroute` nginx
block needs a long `proxy_read_timeout` (130s); routes can take ~2 min.

## The admin-info convention (section 4.5)

Every service exposes `GET /api/admin/<service-name>/info`, gated by `require_auth`,
returning a uniform shape: `service`, `version` (git SHA), `port`, `config`, `env`
(names + masked values), `dependencies` (upstream health checks), `filesystem`,
`runtime` (uptime / request count / last error). No aggregator — a future admin
panel fans out to each service in parallel.
