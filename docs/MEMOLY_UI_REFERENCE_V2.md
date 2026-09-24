# memoLy UI reference v2 — freeze manifest

Checked: 2026-09-24 (Europe/Moscow)

| Property | Frozen value |
|---|---|
| Status | **CANONICAL FROZEN UI REFERENCE** |
| Source | owner-provided final functional state pack |
| Canonical file | `docs/memoly-final-functional-state-pack.html` |
| Absolute local path | `D:\codex\TG_OurMemoriesDevBot\docs\memoly-final-functional-state-pack.html` |
| SHA-256 | `180F8C9B6E60369513CFFD5EB9DBB3CB3397649407DF996DCF907AB0FA38C5B4` |
| Exact byte size | 13,528,494 bytes |
| Encoding | Valid UTF-8 |
| BOM | No |
| Line endings | 11,406 LF; 0 CRLF |
| Git state at freeze | Untracked; not present in `origin/main` at `ea161cffd67b27b7118edcbd1ac9d881ef12f5bf` |

The canonical HTML must not be edited in ordinary UI migration blocks. Any change to it requires a separate decision from the owner. Do not create a second canonical copy.

`docs/design/memoly-handoff-final/11_VISUAL_REFERENCE/memoly-visual-reference.html` remains the historical reference for OLD → NEW comparison. The new canonical file supersedes it for future visual, interaction, and state decisions.

The HTML's static demo JavaScript is an interaction reference, not production architecture. The existing React app and backend remain the production architecture and data flow.

## Technical inventory at freeze

- One `<style>` block, four `<script>` blocks, and 187 unique DOM `id` values; no duplicate IDs found by source parsing.
- 121 named `.composer-layer` containers, of which 115 contain `.composer-screen`; 42 `.state-screen` containers are nested state presentations.
- 169 embedded `data:` image attributes (152 JPEG and 17 PNG, including the favicon); eight CSS `url(...)` values are also `data:` URLs. These numbers count references, not unique images.
- No external image, font, CSS, or script URL, `@import`, or script `src` was found. An isolated Chromium load requested only the local HTML document, returned 200, and logged no console errors, page errors, or failed requests. Rendering therefore did not require network access in that check.

This manifest records the source bytes. It does not turn the demo markup, inline SVG, or hash navigation into production code.
