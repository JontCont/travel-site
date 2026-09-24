---
name: travel-plan-foundation
description: Use when designing or implementing a travel planner for future overseas trips, destinations, dates, bookings, day plans, or shared trip data consumed by an itinerary timeline and map. Also use for 出國計畫、旅程資料與行程管理.
---

# Travel plan foundation

Create one dependable trip model before building timeline or map features. Follow existing project conventions and storage patterns; do not introduce a new framework or service just for this skill.

## Workflow

1. Inspect the existing app, persistence layer, date handling, and tests. If the workspace is empty, propose the smallest viable structure before implementing.
2. Confirm whether a trip is private or shared, how data is stored, and whether reservations and transport are in scope. Do not silently choose a backend or authentication scheme.
3. Model a trip with an ID, title, destination(s), start and end **local dates**, and an IANA time zone for each destination/day. Keep times as local date/time plus zone or as instants with an explicit zone for display; never infer a destination's zone from the browser.
4. Model each day with an ordered list of stops: stable ID, place name/address, optional coordinates and place ID, planned start/end or duration, optional fixed reservation window, notes, and transport mode to the next stop. Mark unconfirmed places and missing coordinates explicitly. Record lodging or the day's start/end anchor where relevant.
5. Enforce start date <= end date, stop times within their day (or explicitly spanning midnight), and no overlapping fixed reservations. Keep draft stops valid without fabricated coordinates, opening hours, travel times, or prices.
6. Expose create/edit/delete/reorder trip, day, and stop operations through the existing app patterns. Keep references by stable ID so timeline and map reflect the same source of truth after edits.
7. Include an upcoming-trip overview, trip detail, day navigation, and clear empty/loading/error states. Show source and last-updated time for any external place details.

## Shared contract

- The timeline skill consumes the ordered day/stops and their time zone, times, durations, and reservation constraints.
- The route skill consumes the same stop IDs and coordinates plus the day's start/end anchors. Its computed legs, durations, provenance, and warnings are **derived data**, not manually maintained distances on stops.
- Editing or reordering a stop invalidates affected route estimates; do not keep stale route summaries or display an unchecked route as verified.

## Acceptance

- A future trip with multiple days can be saved, reopened, edited, and shown consistently in both day and map views.
- A stop without coordinates remains visible as a draft but is not misrepresented as routed.
- Cross-time-zone dates and fixed reservations retain their intended local times after reload.
