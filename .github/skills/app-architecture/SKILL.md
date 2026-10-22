---
name: app-architecture
description: Use when changing this travel-site's server or deployment: API routes, login and role gates, sessions, SQLite storage, Docker or compose files, environment variables, or AMap key handling. Also use for 架構開發、後端 API、登入權限、部署與環境變數.
---

# App architecture

How to make safe changes to the server, auth, storage, and deployment. The facts (endpoints, roles, env vars) are in [architecture.md](../project-reference/references/architecture.md). Read that first, then use this skill for the change itself.

## Workflow

1. Read [architecture.md](../project-reference/references/architecture.md) and the code it cites. Confirm the current behavior before you plan.
2. Choose the role for every new route explicitly. Reads need any session. Writes to trip data are admin-only. The notepad is the only viewer write, and it changes one trip's notepad field. Do not add another viewer write without asking the user.
3. Add new `/api/*` handlers inside `createTripApi`, after the existing session check. A handler outside that check skips authentication.
4. Keep secrets on the server. `AMAP_WEB_KEY` must never reach the client. `AMAP_API_KEY` is returned only to authenticated sessions. No key may be returned to an unauthenticated caller.
5. Keep the fail-closed behavior. A missing or weak access code must keep login and data endpoints at 503. Apply the same pattern to any new required variable. `server.mjs` sets `TRIP_COOKIE_SECURE=1` when it is unset, so test local login with that default in mind.
6. For storage changes: the workspace is one JSON row with no migration. Before you make the DTO stricter, check that existing rows still pass, because a stricter DTO can turn `GET /api/workspace` into a 500. If the shape must change, write the migration and its test first, and back up `data/trips.sqlite`.
7. For deployment changes: if `server.mjs` or `route-api.mjs` imports a new file from `src/`, add that file to the Dockerfile COPY list. Otherwise the container fails at startup. Keep compose and `.env.example` values as placeholders.
8. Add tests in `tests/route-api.test.mjs` for the new route's 401 (no session), 403 (wrong role), and 503 (not configured) cases. Then run the checks in [validation.md](../project-reference/references/validation.md).

## Acceptance

- A new data route returns 401 without a session and 403 for a viewer write, and a test covers both.
- Missing or weak codes still return 503 from login and data endpoints.
- `npm test` and `npm run build` pass.
- Every new runtime import from `src/` in the server appears in the Dockerfile COPY list.
- No real code, key, or passcode appears in the diff.
