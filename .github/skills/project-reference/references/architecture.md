# Architecture and runtime

## Layout

| Path | Role |
|---|---|
| `server.mjs` | HTTP server. Mounts the trip API, then the walk API, then static files from `dist/`. Sets `TRIP_COOKIE_SECURE=1` when the variable is unset. |
| `route-api.mjs` | `createTripApi` (auth, workspace, notepad, map config) and `walkApi` (`POST /api/walk`). Exports `openTripDatabase`. |
| `src/dto/trip-workspace.dto.ts` | Type guards for the workspace. Used by the client and the server. |
| `src/models/` | Types for trips, stops, and walking legs. |
| `src/services/` | Client services: auth, workspace load and save, map links, walking evaluation, dates. |
| `src/App.tsx` | Main UI: trip list, day timeline, photos, flights, notepad. |
| `Dockerfile`, `docker-compose.yml` | Container build and runtime. |

## Endpoints

| Method and path | Access | Notes |
|---|---|---|
| `GET /api/auth/status` | Public | Used by the container healthcheck. |
| `POST /api/auth/login` | Public | Body `{code}`, max 2048 bytes. 401 for a wrong code. 429 after five failures from one client address, for 15 minutes. 503 when the codes are missing or invalid. |
| `POST /api/auth/logout` | Public | Ends the current session. |
| `GET /api/map-config` | Any session | Returns `AMAP_API_KEY` (the JS key). 401 without a session. |
| `GET /api/workspace` | Any session | Returns the workspace. 401 without a session. 503 when the codes are not configured. |
| `PUT /api/workspace` | Admin | Replaces the whole workspace. Max 10 MB (413). Viewer gets 403. Invalid data gets 400 and the stored row is unchanged. |
| `PUT /api/notepad` | Any session | Body exactly `{tripId, notepad}`, max 100 KB. Writes that trip's notepad only. 404 when the trip is missing. |
| `POST /api/walk` | Any session | Body `{origin, destination}`, each a GCJ-02 `"lng,lat"` string. Body max 2048 bytes (413). Needs `AMAP_WEB_KEY` (503 if unset). 405 for other methods, 400 for invalid coordinates, 502 for a provider error or incomplete data. Returns `{meters, minutes}`. |

Every `/api/*` path except the auth endpoints must pass the session check before its handler runs. The check returns 401 first, then 503 if the codes are not configured.

## Roles and sessions

- Two codes: `TRIP_VIEW_CODE` (viewer) and `TRIP_ADMIN_CODE` (admin). Each must be at least 16 characters, and they must differ. If either is invalid, the server fails closed: login returns 503, and data endpoints return 503 after the session check.
- Session cookie `trip_session` is HttpOnly, SameSite=Strict, and Path=/. It is marked Secure when `TRIP_COOKIE_SECURE=1` or `NODE_ENV=production`. `server.mjs` sets `TRIP_COOKIE_SECURE=1` when the variable is unset. Browsers accept Secure cookies on `http://localhost`, but a plain-HTTP LAN address will not keep the cookie unless you set `TRIP_COOKIE_SECURE=0`.
- Sessions last six calendar months. The `auth_sessions` table stores a SHA-256 hash of the token, the role, and a hash of the credential. Changing a role's code invalidates that role's sessions.
- The rate limit uses the socket address. `X-Forwarded-For` is read only when `TRIP_TRUST_PROXY=1`.

## Storage

- `node:sqlite` `DatabaseSync` at `TRIP_DATABASE_PATH`. The default is `./data/trips.sqlite`. Docker uses `/data/trips.sqlite`.
- Table `workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT)` holds one row.
- There is no migration framework. A stricter DTO can make `GET /api/workspace` fail with 500 on rows written earlier.
- The client reads the localStorage key `travel-planner-v1` only for one-time migration: when SQLite returns 404 and the user is admin.

## Deployment

`Dockerfile`:
- Multi-stage build on `node:24-alpine`.
- Runtime ENV: `PORT=4187`, `TRIP_HOST=0.0.0.0`, `TRIP_DATABASE_PATH=/data/trips.sqlite`, `TRIP_COOKIE_SECURE=1`.
- Runs as `USER node`. The healthcheck calls `/api/auth/status`. CMD is `node server.mjs`.
- Runtime COPY list: `dist`, `package.json`, `route-api.mjs`, `server.mjs`, `src/dto/trip-workspace.dto.ts`, and `src/services/date.service.ts`. Any new runtime import from `src/` must be added here.

`docker-compose.yml`:
- Image from `TRIP_IMAGE`, published to GHCR by `.github/workflows/publish-image.yml`.
- `user: "1026:100"`, volume `./data:/data`, port `4187:4187`, `read_only: true`, `tmpfs: /tmp`, `cap_drop: ALL`, `no-new-privileges`.
- `TRIP_VIEW_CODE` and `TRIP_ADMIN_CODE` must be set. `AMAP_API_KEY` and `AMAP_WEB_KEY` are optional.

## Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `TRIP_VIEW_CODE` | `route-api.mjs` | Viewer access code, at least 16 characters. |
| `TRIP_ADMIN_CODE` | `route-api.mjs` | Admin access code, at least 16 characters, different from the viewer code. |
| `TRIP_DATABASE_PATH` | `openTripDatabase` | SQLite file path. |
| `TRIP_HOST` | `server.mjs` | Bind address. Local default `127.0.0.1`. |
| `PORT` | `server.mjs` | Listen port. Local default 4173. |
| `TRIP_TRUST_PROXY` | `route-api.mjs` | `1` makes the rate limit read `X-Forwarded-For`. |
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
