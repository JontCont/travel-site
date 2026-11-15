---
name: travel-record-writing
description: Use when changing how trip records are written to the system: admin autosave, viewer notepad saves, or trip, stop, flight, lodging, and photo fields saved to the SQLite workspace. Also use for 寫入系統、紀錄寫入、自動儲存、記事本、旅程資料寫入.
---

# Travel record writing

How trip data moves from the UI into the single SQLite workspace row, and the rules that keep it valid. Endpoints and roles are in [architecture.md](../project-reference/references/architecture.md). The data shape is in [travel-plan-foundation](../travel-plan-foundation/SKILL.md).

## Write paths

| Path | Who | Route | Client code |
|---|---|---|---|
| Admin autosave | Admin | `PUT /api/workspace` (whole document) | `App.tsx` effect on `workspace` calls `saveWorkspace`. Writes are serialized by `saveSequence`. |
| Admin edits | Admin | Through autosave | `updateTrip` in `App.tsx`. Returns early for non-admins. |
| Notepad | Any session | `PUT /api/notepad` with `{tripId, notepad}` | `saveTripNotepad(trip.id, draft)` in `src/services/trip-workspace.service.ts`. |

## Workflow

1. Name the write path you are changing, using the table. If the change adds a new write path, add a row and explain why it needs one.
2. For a new trip field, change three things together: the type in `src/models/trip.ts`, the check in `src/dto/trip-workspace.dto.ts`, and a case in `tests/trips.test.mjs`. Make the field optional so existing rows stay valid.
3. Keep IDs stable. Trip IDs must be unique, and `activeTripId` must match an existing trip. Editing or reordering a stop must not change its ID.
4. The DTO rejects a trip whose `days` keys do not match `listDates(startDate, endDate)`. Any date edit must produce matching keys in the same save.
5. The server validates every workspace write with the same DTO. Invalid data gets 400 and the stored row is unchanged. Do not rely on client-side checks alone.
6. Keep notepad writes scoped. `PUT /api/notepad` changes only one trip's notepad and must not touch other trips.
7. Known risk: `PUT /api/workspace` replaces the whole document, and the last write wins. An admin's autosave can overwrite a notepad that a viewer saved after the admin loaded the page. Do not add another whole-document write for data that other roles also write, unless you add a version check or a merge.
8. Direct SQL edits are a last resort. Back up `data/trips.sqlite` first. Change only `workspace.data_json`. Make sure the JSON passes the DTO, because a row that fails it can break `GET /api/workspace`. Then read the result back through the API.

## Acceptance

- A viewer's `PUT /api/workspace` returns 403. A viewer's `PUT /api/notepad` for an existing trip succeeds and changes only that trip's notepad.
- A payload that fails the DTO returns 400, and the stored row is unchanged.
- Editing or reordering stops keeps every stop ID unchanged.
