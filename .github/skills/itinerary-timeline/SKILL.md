---
name: itinerary-timeline
description: Use when changing this travel-site's day timeline: stop order and reordering, stop cards, opening-hours status, transfer lines, and time or flight conflict warnings. Also use for 行程時間軸、每日行程和 timeline.
---

# Itinerary timeline

How the day timeline works today in `src/App.tsx`. The data comes from the trip model in [travel-plan-foundation](../travel-plan-foundation/SKILL.md). Shared facts are in [project-reference](../project-reference/SKILL.md).

## Current behavior

- Stops render in array order. The app does not sort by `time`; the `time` value is used only by the time-conflict check.
- Admins reorder with 上移/下移 (`moveStop`) and edit with 編輯. Viewers see the timeline read-only.
- Stop card address line: a stop with `hideFromMap` shows "非地點行程 · 不顯示於地圖". Otherwise it shows the address, then "已輸入座標（請確認來源）" when `coordinates` is set or "尚無座標" when it is empty.
- A `hideFromMap` stop has no 地圖查看 link. The transfer line between two stops is hidden if either one has `hideFromMap`.
- Opening hours (under 更多資訊): "已確認" only when `openingHoursStatus` is `confirmed` and the hours, source, and `openingHoursCheckedAt` are all present. `confirmed` with missing parts shows "資料未齊". Everything else shows "待確認".
- Transfer line between consecutive stops always says "↳ 移動時間尚未驗證". China trips with an AMap key and valid coordinates on both stops also get an AMap LightMap link. Other trips get Google Maps directions links for walking, transit, and driving. The timeline never shows travel minutes.
- Conflict warnings in `App.tsx` (`flightConflict`, `timeConflict`):
  - Flight: a stop before the outbound arrival on the departure day, or at or after the return departure on the return day.
  - Time: a stop starts before the previous stop's start plus `durationMax ?? duration`. Travel time is not included.
- Not implemented: travel-time feasibility, buffers, reservation windows, per-day travel or walking totals, map-marker-to-timeline selection sync, and daylight-saving-aware times. Do not describe these as existing behavior.

## Workflow

1. Before you plan, read the timeline section of `src/App.tsx`, the two conflict checks, and the `Stop` type in `src/models/trip.ts`. Confirm the behavior above still holds.
2. Keep stop IDs stable through reorder and edit. Other data refers to a stop by its ID.
3. To change order, work with the array order that `moveStop` changes. Do not add time sorting unless the user asks, because sorting would change what 上移/下移 means.
4. Change conflict rules in the helper logic, not in the card markup. Each warning message must match what its rule checks. The time check ignores travel time, so its message must not say the schedule accounts for it.
5. Keep the transfer line honest: it must say travel time is unverified until a routing source provides it. For walking limits and routed walking times, see [walkable-map-routing](../walkable-map-routing/SKILL.md).
6. The conflict logic in `App.tsx` has no tests today (see [validation.md](../project-reference/references/validation.md)). If you move a rule into a service, add its test in `tests/`.

## Acceptance

- Reordering with 上移/下移 keeps each stop's ID and changes only the array order.
- A stop that starts before the previous stop's start plus its `durationMax` (or `duration` when there is no max) shows the time-conflict message.
- A stop before outbound arrival, or at or after return departure, on the matching day shows the flight-conflict message.
- The transfer line shows no minute count unless a routing source supplied one.
- A `hideFromMap` stop has no 地圖查看 link, and the transfer lines on either side of it are hidden.
- Opening hours show "已確認" only when status, hours, source, and checkedAt are all present.
