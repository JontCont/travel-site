---
name: trip-photo-album
description: Use when adding, changing, or embedding a trip photo album, Immich share link, photo gallery, or 相簿 tab for a travel trip. Also use for 旅程相簿、相簿連結、Immich 分享、iframe 相簿.
---

# Trip photo album

Embed a shared photo album per trip using the trip model in `../travel-plan-foundation/SKILL.md`. The album is a read-only view of an external Immich share link; the app stores only the URL. Shared facts are in [project-reference](../project-reference/SKILL.md), and write rules are in [travel-record-writing](../travel-record-writing/SKILL.md).

## Workflow

1. Store the link as `photoShareUrl` on the trip (https only). Set it through the admin form or, for a known trip, update the `workspace` row in `data/trips.sqlite`. Follow the direct SQL rules in [travel-record-writing](../travel-record-writing/SKILL.md), then read back the value. Do not hard-code URLs in code.
2. Keep the album available for every trip, including China trips. Do not gate it behind the China check used for AMap links.
3. Render the album in a 相簿 tab as a full-width iframe (`photos-frame`). The section uses the classes `details-grid photos-grid`. Keep `photos-grid`, which forces a single column, so the album never sits beside text.
4. Keep the section copy minimal. The heading is enough; do not add explanatory text about the embed mechanism.
5. Verify the embed from an `http://` origin (for example `localhost`), not a `data:` page. A `data:` parent is an opaque origin, and Immich then fails on `localStorage` with a 500 error. This is a test artifact, not an app bug.
6. The live app requires the NAS passcode to log in. If you cannot log in, say so explicitly rather than claiming the tab was visually verified.

## Constraints

- Immich has no sub-path support, so the album is only ever an external iframe. Do not proxy or mount Immich under this site.
- Validate the URL with the https-only check in the DTO layer. Reject `javascript:`, `http:`, and non-string values.
- Do not commit or store the NAS passcode or any Immich API key in the repo.

## Acceptance

- A trip with a valid https share link shows the album in the 相簿 tab, full width.
- A trip without a link shows the "尚未設定相簿連結。" empty state.
- Clearing the admin field removes `photoShareUrl` from the trip.
- The DTO test rejects `javascript:` and `http:` links.
