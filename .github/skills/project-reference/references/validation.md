# Validation and tests

## npm scripts

| Command | Runs | Use for |
|---|---|---|
| `npm test` | `node --test tests/*.test.mjs` | Server, DTO, model, and service logic. |
| `npm run build` | `tsc -b && vite build` | Type check and production bundle in `dist/`. |
| `npm run lint` | `oxlint` | Lint. |

## Test map

| File | Covers |
|---|---|
| `tests/route-api.test.mjs` | Coordinate rejection, AMap duration and distance, missing duration, workspace persistence, invalid workspace rejection, fail-closed config, AMap key only when authenticated, place-search destination, rate limiting, viewer read-only, notepad endpoint, session requirement, six-month sessions and invalidation. |
| `tests/trips.test.mjs` | Destination-local dates, trip status, sort order, stop time and duration validation, workspace DTO, hotel details, https photo URL, notepad DTO, opening hours, legacy migration, malformed backups. |
| `tests/footprint.test.mjs` | Timeline export parsing for three shapes, unknown formats, merge without duplicates, Google links, China trips use AMap. |
| `tests/walking.test.mjs` | `evaluateWalk` per-leg and daily limits. An incomplete route is never compliant. |

## Known gaps

- No test covers daylight-saving transitions.
- No test covers the timeline conflict checks in `src/App.tsx`.
- No test covers the 300-entry footprint cap.
- No automated test covers the Dockerfile or compose file. Check the COPY list by reading the server's imports.
- The suite has no browser tests. UI changes need a manual check.

## Minimum checks by change

| Change | Run |
|---|---|
| Docs or skills only | Nothing beyond checking that relative links resolve. |
| `route-api.mjs` or `server.mjs` | `npm test` and `npm run build`. |
| DTO or models in `src/` | `npm test` and `npm run build`. |
| Client UI in `src/` | `npm run build` and `npm run lint`, then a manual check in the browser. |
| Dockerfile or compose | Read the COPY list against the server's imports. No automated test exists. |

If `npm run lint` already fails before your change, report the existing errors and do not fix unrelated ones.
