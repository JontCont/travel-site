---
name: itinerary-timeline
description: Use when designing or implementing a day-by-day travel itinerary timeline, chronological schedule, stop cards, reservations, day navigation, or map-to-timeline synchronization. Also use for 行程時間軸、每日行程和 timeline.
---

# Itinerary timeline

Build a readable schedule from the trip/day/stop model in `../travel-plan-foundation/SKILL.md`. A timeline is not just an ordered list: it must include realistic movement and uncertainty.

## Workflow

1. Inspect the app's trip model, existing schedule UI, routing results, and tests. Use stable trip/day/stop IDs; keep map markers and timeline cards tied to those IDs.
2. Lay out days in the destination's local time zone. Separate fixed events (flights, check-in, tickets) from movable stops; display duration, status, and optional notes.
3. Place route legs **between** consecutive stops and, when supplied, from/to the day's lodging or other anchors. Show mode, routed walking minutes/distance, and source or "not checked" when unavailable. Never treat straight-line distance as walking time.
4. Include visit duration, travel time, configurable buffers, and opening/reservation windows in feasibility checks. Flag overlaps, closing-time conflicts, and impossible transfers; do not silently shift a fixed reservation.
5. Reordering a stop updates both the visible order and affected route requests. An unverified leg displays as pending/unavailable rather than showing an old estimate.
6. Keep both a chronological list view and a map-linked selection: selecting a stop highlights its marker; selecting a marker focuses its timeline card. Make the list usable without a map, including keyboard navigation where applicable.
7. Show a per-day summary with scheduled time, travel time, walking time, and unresolved conflicts; distinguish estimated values from confirmed bookings.

## Acceptance

- Editing or reordering a stop updates timeline and map selection without ID drift.
- A fixed event with insufficient transfer time yields a visible conflict rather than a feasible-looking schedule.
- Missing routing data yields an explicit "not checked" state; it does not silently count as zero minutes.
- A destination-day spanning a daylight-saving change displays its intended local event times.
