---
name: walkable-map-routing
description: Use when designing or implementing travel maps, multi-stop route planning, walking-distance limits, route alternatives, transit suggestions, or day-by-day map itineraries. Also use for 地圖路線、步行距離、不要走太遠的行程規劃.
---

# Walkable map routing

Plan routes against the trip/day/stop model in `../travel-plan-foundation/SKILL.md` and surface results in `../itinerary-timeline/SKILL.md`. A map provider is an implementation choice, not a reason to claim distances are known without a route.

## Required input before every new plan

Ask the traveler for **both** their maximum walking time per leg and maximum total walking time per day. There are no default limits. Ask which transport modes they accept (for example transit or taxi) and whether lodging/start/end anchors must be included. If an input is missing, stop before declaring any route "within limit"; present an unverified draft instead. If the traveler changes a limit, recompute compliance.

## Workflow

1. Inspect existing mapping/routing integration, credentials setup, and API usage constraints. If there is no provider, present viable providers and obtain a choice before implementation that needs an API; keep keys server-side when required by the provider and never commit secrets.
2. Resolve stops to coordinates or explicit unresolved states. Do not guess a destination from a similar name. Route consecutive places using a provider that supports the requested mode and returns **routed** distance and duration; geographic straight-line distance is not a valid substitute.
3. Include all walking legs, including transfers to and from transit, and the day's supplied start/end anchors. Record leg IDs, ordered stop IDs, mode, routed walking distance/meters and duration/minutes, provider, calculation time, and provider warnings. Respect local opening hours and fixed reservations when reordering; never optimize only for distance at the cost of an impossible schedule.
4. Compare every walking leg's minutes against the user's per-leg limit and the **sum** of all walking minutes against the daily limit. Check the numeric thresholds directly, not just visual proximity on a map. Keep transit/vehicle time separate from walking time.
5. If a limit fails, first regroup nearby movable stops or adjust their order; then offer transit, taxi, removing a stop, or splitting the day. Re-route each candidate, report what changed and its actual leg/day walking totals, and preserve fixed events. If no candidate satisfies both limits, explicitly say so and list trade-offs; do not label the route compliant.
6. Render markers in itinerary order and show route geometry, leg mode, walking duration/distance, and daily totals. Display over-limit legs and the daily overage prominently in both map and timeline; indicate whether data is estimated, stale, unavailable, or provider-verified.
7. On stop/anchor/order/mode/limit change, invalidate affected routes and recalculate before claiming compliance. On provider error, missing coordinates, unsupported mode, or absent coverage, show an explicit unverified state and actionable next step rather than zero distance or a straight-line fallback.

## Acceptance example

Given traveler-provided limits of 12 walking minutes per leg and 50 walking minutes per day: legs of 11, 13, and 20 minutes total 44 minutes; this day **fails** because the 13-minute leg exceeds the per-leg limit. Legs of 10, 12, 12, 11, and 9 minutes total 54 minutes; this day **fails** the daily limit. A candidate is compliant only if every known walking leg and the complete day satisfy their respective limits, with no unresolved legs.
