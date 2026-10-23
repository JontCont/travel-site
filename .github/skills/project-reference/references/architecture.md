# Architecture and runtime

## Layout

| Path | Role |
|---|---|
| `server.mjs` | HTTP server. Mounts the trip API, then the walk API, then static files from `dist/`. Sets `TRIP_COOKIE_SECURE=1` when the variable is unset. |
| `route-api.mjs` | `createTripApi` (auth, workspace, notepad, map config, access codes) and `walkApi` (`POST /api/walk`). Exports `openTripDatabase`. |
| `oidc.mjs` | Synology SSO (OIDC) client: config, discovery, PKCE, ID token verification, role mapping. Imported by `route-api.mjs`, so it must be in the Dockerfile COPY list. |
| `src/dto/trip-workspace.dto.ts` | Type guards for the workspace. Used by the client and the server. |
| `src/models/` | Types for trips, stops, and walking legs. |
| `src/services/` | Client services: auth, workspace load and save, map links, walking evaluation, dates. |
| `src/App.tsx` | Main UI: trip list, day timeline, photos, flights, notepad. |
| `Dockerfile`, `docker-compose.yml` | Container build and runtime. |

## Endpoints

| Method and path | Access | Notes |
|---|---|---|
| `GET /api/auth/status` | Public | Returns `{configured, authenticated, role}`. Used by the container healthcheck. |
| `POST /api/auth/login` | Public | Body `{code}` (guest access code), max 2048 bytes. 401 for a wrong code. 429 after five failures from one client address, for 15 minutes. 503 when SSO is not configured. |
| `POST /api/auth/logout` | Public | Ends the current session. |
| `GET /api/auth/oidc/start` | Public | Stores a 10-minute transaction (state, nonce, PKCE verifier) and redirects to the Synology authorize endpoint. Errors redirect to `/?auth_error=<code>`. |
| `GET /api/auth/oidc/callback` | Public | Checks state, exchanges the code, verifies the ID token, maps the role, and sets the session cookie. Returns 200 HTML with a meta refresh instead of 302, so the cookie survives the cross-site redirect. Errors redirect to `/?auth_error=<code>`. |
| `GET /api/access-codes` | Admin | Lists `{id, label, tripIds, createdAt}`. Never returns code values. 403 for other roles. |
| `POST /api/access-codes` | Admin | Body `{label, tripIds}`: label 1–60 characters, 1–100 known trips. 201 `{code, access}`. The code is shown once. |
| `DELETE /api/access-codes/:id` | Admin | Revokes the code and deletes its sessions. 404 when missing. |
| `GET /api/map-config` | Any session | Returns `AMAP_API_KEY` (the JS key). 401 without a session. |
| `GET /api/workspace` | Any session | Returns the workspace. Code sessions get only their assigned trips, and 403 when none are assigned. 401 without a session. 503 when SSO is not configured. |
| `PUT /api/workspace` | Admin | Replaces the whole workspace. Max 10 MB (413). Non-admin sessions get 403. Invalid data gets 400 and the stored row is unchanged. |
| `PUT /api/notepad` | Any session | Body exactly `{tripId, notepad}`, max 100 KB. Writes that trip's notepad only. Code sessions are limited to their assigned trips. 404 when the trip is missing. |
| `POST /api/walk` | Any session | Body `{origin, destination}`, each a GCJ-02 `"lng,lat"` string. Body max 2048 bytes (413). Needs `AMAP_WEB_KEY` (503 if unset). 405 for other methods, 400 for invalid coordinates, 502 for a provider error or incomplete data. Returns `{meters, minutes}`. |

Every `/api/*` path except `/api/auth/*` must pass the session check before its handler runs. The check returns 401 first, then 503 if SSO is not configured.

## Roles and sessions

- Roles come from Synology SSO (`oidc.mjs`). `admin` is a DSM user in `TRIP_OIDC_ADMIN_GROUP` or `TRIP_OIDC_ADMIN_USERS`. `viewer` is any other DSM user (read-only). `code` is a guest access code that an admin issued, read-only and limited to the trips the admin picked.
- If SSO is not configured, or the issuer or redirect URI is not HTTPS, the server fails closed. Login and data endpoints return 503, and `GET /api/auth/status` reports `configured: false`.
- Access codes are generated server-side from 18 random bytes (base64url). Only the SHA-256 hash is stored, in `access_codes`, and the code is shown once.
- The Synology login uses Authorization Code with PKCE (S256). The `state` is stored as a hash. The `nonce` and PKCE verifier are stored in `oidc_transactions` for 10 minutes. The ID token is verified with RS256 against the issuer's JWKS, checking `iss`, `aud`, `azp`, `exp`, `iat` (60 s skew), `nonce`, `sub`, and the username.
- Session cookie `trip_session` is HttpOnly, SameSite=Strict, and Path=/. It is marked Secure when `TRIP_COOKIE_SECURE=1` or `NODE_ENV=production`. `server.mjs` sets `TRIP_COOKIE_SECURE=1` when the variable is unset. Browsers accept Secure cookies on `http://localhost`, but a plain-HTTP LAN address will not keep the cookie unless you set `TRIP_COOKIE_SECURE=0`.
- Sessions last six calendar months. The `auth_sessions` table stores a SHA-256 hash of the token, the role (`admin`, `viewer`, or `code`), and the subject (the DSM username or the access code id). Code sessions re-check the access code on every request, and revoking a code deletes its sessions.
- The rate limit uses the socket address. With `TRIP_TRUST_PROXY=1`, it reads `CF-Connecting-IP` first, then the rightmost `X-Forwarded-For` entry.

## Storage

- `node:sqlite` `DatabaseSync` at `TRIP_DATABASE_PATH`. The default is `./data/trips.sqlite`. Docker uses `/data/trips.sqlite`.
- Table `workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT)` holds one row.
- Auth tables are `auth_sessions`, `access_codes`, and `oidc_transactions`. Upgrading from the code-based login drops the old `auth_sessions` table (the one with `credential_hash`), so existing logins end once.
- There is no migration framework. A stricter DTO can make `GET /api/workspace` fail with 500 on rows written earlier.
- The client reads the localStorage key `travel-planner-v1` only for one-time migration: when SQLite returns 404 and the user is admin.

## Deployment

`Dockerfile`:
- Multi-stage build on `node:24-alpine`.
- Runtime ENV: `PORT=4187`, `TRIP_HOST=0.0.0.0`, `TRIP_DATABASE_PATH=/data/trips.sqlite`, `TRIP_COOKIE_SECURE=1`.
- Runs as `USER node`. The healthcheck calls `/api/auth/status`. CMD is `node server.mjs`.
- Runtime COPY list: `dist`, `package.json`, `route-api.mjs`, `oidc.mjs`, `server.mjs`, `src/dto/trip-workspace.dto.ts`, and `src/services/date.service.ts`. Any new runtime import of a repo file (root `.mjs` or `src/`) must be added here.

`docker-compose.yml`:
- Image from `TRIP_IMAGE`, published to GHCR by `.github/workflows/publish-image.yml`.
- `user: "1026:100"`, volume `./data:/data`, port `4187:4187`, `read_only: true`, `tmpfs: /tmp`, `cap_drop: ALL`, `no-new-privileges`.
- `TRIP_OIDC_*` values pass through with empty defaults. The container starts without them, but SSO stays unconfigured. `AMAP_API_KEY`, `AMAP_WEB_KEY`, and `TRIP_TRUST_PROXY` are optional. Only variables listed under `environment` reach the container.

## Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `TRIP_OIDC_ISSUER` | `oidc.mjs` | DSM SSO issuer, `https://<NAS>/webman/sso`. |
| `TRIP_OIDC_CLIENT_ID` | `oidc.mjs` | SSO Server client ID. |
| `TRIP_OIDC_CLIENT_SECRET` | `oidc.mjs` | SSO Server client secret. Server-side only. |
| `TRIP_OIDC_REDIRECT_URI` | `oidc.mjs` | Must be HTTPS and match the SSO client's redirect URI exactly. |
| `TRIP_OIDC_ADMIN_GROUP` | `oidc.mjs` | DSM group that maps to `admin`. Default `administrators`. |
| `TRIP_OIDC_ADMIN_USERS` | `oidc.mjs` | Comma-separated DSM usernames that map to `admin`. |
| `TRIP_DATABASE_PATH` | `openTripDatabase` | SQLite file path. |
| `TRIP_HOST` | `server.mjs` | Bind address. Local default `127.0.0.1`. |
| `PORT` | `server.mjs` | Listen port. Local default 4173. |
| `TRIP_TRUST_PROXY` | `route-api.mjs` | `1` makes the rate limit read `CF-Connecting-IP`, then the rightmost `X-Forwarded-For`. |
| `TRIP_COOKIE_SECURE` | `route-api.mjs` | `1` forces the Secure cookie flag. `server.mjs` defaults it to `1` when unset. |
| `NODE_ENV` | `route-api.mjs` | `production` forces the Secure cookie flag. |
| `AMAP_API_KEY` | `/api/map-config` | AMap JS key. Returned only to authenticated sessions. |
| `AMAP_WEB_KEY` | `/api/walk` | AMap Web service key. Server-side only. |
| `TRIP_IMAGE` | `docker-compose.yml` | Container image reference. |

## Map providers

- `isChinaTrip(country)` in `src/services/map.service.ts` is true when the country starts with 中國.
- China trips use AMap for place search through `uri.amap.com/search`, and LightMap navigation through `m.amap.com/navi/` with the JS key from `/api/map-config`.
- Other trips use Google Maps search and directions links for walking, transit, and driving. The app calls no routing API for them.
- Only the server's `/api/walk` computes walking distance and time, and only for AMap. No client code calls it.
