---
name: travel-plan-foundation
description: Use when changing this travel-site's trip data model: trips, dates, time zones, days, stops, lodging, flights, and workspace validation. Also use for 出國計畫、旅程資料與行程管理.
---

# Travel plan foundation

The trip data model the app stores and validates. Types are in `src/models/trip.ts`, and validation is in `src/dto/trip-workspace.dto.ts`. Shared facts are in [project-reference](../project-reference/SKILL.md). Write paths are in [travel-record-writing](../travel-record-writing/SKILL.md).

## Current model

- Workspace: `{trips, activeTripId}`. The DTO requires a non-empty `trips` array and an `activeTripId` that matches a trip. Trip IDs must be unique.
- Trip dates: `startDate` and `endDate` are local dates. `endDate` must not be before `startDate`.
- `days` is a record keyed by date. Its keys must equal every date from `startDate` through `endDate`. Each value is that day's ordered stop list.
- `timeZone` is one string per trip, not per day. The DTO checks only that it is a non-empty string, so an invalid name passes validation and fails later when dates are formatted.
- `destination` is one string. A trip has one destination.
- Lodging: `hotelName`, `hotelAddress`, and optional `hotelCoordinates`, `hotelDetails`, and `hotelFacilityGroups`.
- Optional trip fields: `notepad`, `footprints`, `photoShareUrl` (https only, checked by the DTO), `travelers`, `outboundFlight`, `returnFlight`, and luggage limits (`carryOnKg`, `checkedBagKg`, `personalItemPieces`, `carryOnPieces`, `checkedBagPieces`).
- Stop: `id`, `name`, `address`, `time` (HH:mm), `duration`, optional `durationMax`, `notes`, `coordinates` (a string; an empty value shows "尚無座標"), `hideFromMap`, and opening-hours fields (`openingHours`, `openingHoursStatus` as `unverified` or `confirmed`, `openingHoursSource`, `openingHoursCheckedAt`).
- Not in the model: reservation windows, travel time between stops, stored route results, multiple destinations, and per-day time zones.

## Workflow

1. Before you change the model, read `src/models/trip.ts`, `src/dto/trip-workspace.dto.ts`, and `tests/trips.test.mjs`. They are the source of truth.
2. Add new fields as optional so that stored rows still pass the DTO. Then update the type, the DTO check, and a test case in `tests/trips.test.mjs`.
3. Keep dates and day keys in step. A date edit must change the `days` keys in the same save, or the DTO rejects it.
4. Do not store derived data (route results, travel minutes, computed conflicts) on stops. Compute it from the stored model when it is shown.
5. For storage and write-path changes, follow [travel-record-writing](../travel-record-writing/SKILL.md).
6. Validate with `npm test` and `npm run build`. See [validation.md](../project-reference/references/validation.md).

## Known gaps

- One time zone per trip, not validated as an IANA name. A trip that crosses time zones needs a model change first.
- Multiple destinations are not supported.
- Reservation windows and stop-to-stop travel time are not modeled.
- Opening hours are free text, not structured hours.

## Acceptance

- A multi-day trip saves and reloads with the same dates, day keys, and stop IDs.
- A workspace with `endDate` before `startDate`, mismatched `days` keys, duplicate trip IDs, or an `activeTripId` that matches no trip is rejected with 400, and the stored row does not change.
- `photoShareUrl` accepts only https URLs.
- A stop with empty `coordinates` shows "尚無座標" and gets no AMap transfer link.
