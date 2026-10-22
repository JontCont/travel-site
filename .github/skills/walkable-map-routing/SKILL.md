---
name: walkable-map-routing
description: Use when changing this travel-site's maps or walking-distance code: map links for China and other trips, the /api/walk endpoint, evaluateWalk limits, or any walk-check UI. Also use for 地圖路線、步行距離、不要走太遠的行程規劃.
---

# Walkable map routing

How maps and walking distance work today. Shared map facts (providers, endpoints, keys) are in [architecture.md](../project-reference/references/architecture.md). Stops come from [travel-plan-foundation](../travel-plan-foundation/SKILL.md), and transfer lines are in [itinerary-timeline](../itinerary-timeline/SKILL.md).

## Current behavior

- The in-app walk-check button was removed on purpose. No client code calls `/api/walk` or `evaluateWalk`. Do not restore the button without asking the user first.
- Provider choice comes from `isChinaTrip(country)` in `src/services/map.service.ts`. Trips whose country starts with 中國 use AMap. Other trips use Google Maps.
- China trips: place search links go to `uri.amap.com/search`. Navigation links open AMap LightMap (`m.amap.com/navi/`) with the JS key from `/api/map-config`.
- Other trips: search and directions links go to Google Maps (walking, transit, driving) and open in a new tab. The app computes nothing.
- `POST /api/walk` (`walkApi` in `route-api.mjs`) is a server-side AMap Web service walking query. It needs a session and `AMAP_WEB_KEY`. The body is `{origin, destination}`, each a GCJ-02 `"lng,lat"` string. It returns `{meters, minutes}`, with minutes rounded up from seconds. The request times out after 12 seconds. Error codes: 405, 400, 413, 502, 503.
- `evaluateWalk(legs, maxLegMinutes, maxDayMinutes, expectedLegs)` in `src/services/walking.service.ts` is a pure function with tests. It returns `unverified` first (non-positive limits, a leg count that does not equal `expectedLegs`, or invalid values), then `over` (any leg above the per-leg maximum, or a total above the daily maximum), and otherwise `within`. `WalkLeg` is `{fromId, toId, minutes, meters}` in `src/models/walking.ts`.
- Not implemented: a provider comparison, route planning or reordering to fit limits, transit or taxi suggestions, route alternatives, stored route results, and recalculation after edits.

## If you rebuild the walk check

Ask the traveler for both limits before any new plan is computed: the maximum walking minutes per leg and the maximum total walking minutes per day. Do not assume defaults. Then:

1. Keep `AMAP_WEB_KEY` on the server. Use `/api/walk` for China trips only, unless the user approves another provider.
2. Pass the routed legs to `evaluateWalk` in itinerary order. An incomplete route must stay `unverified`, never `within`.
3. Show over-limit legs and the daily overage in the timeline and on the map, with the data source and time.
4. If a limit fails, offer reordering within the day, transit, or removing a stop. Re-route each candidate. Do not call a route compliant unless every leg and the day total pass.
5. Changing a stop, its order, or a limit invalidates the affected routes. Recalculate before showing a result.
6. Validate with `tests/walking.test.mjs` and the `/api/walk` cases in `tests/route-api.test.mjs`.

## Acceptance example

With limits of 12 walking minutes per leg and 50 per day:

- Legs of 11, 13, and 20 minutes: `over`, because the 13- and 20-minute legs exceed the per-leg limit.
- Legs of 10, 12, 12, 11, and 9 minutes (total 54): `over`, because the total exceeds the daily limit.
- Legs of 10, 12, 11, and 9 minutes (total 42), with `expectedLegs` of 4: `within`.
