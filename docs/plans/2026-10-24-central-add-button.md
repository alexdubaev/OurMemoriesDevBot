# CENTRAL-ADD-BUTTON

Base: df03a3730ad77e94ab65db687cacbc0058768371. Branch fix/central-add-button; isolated .worktrees/central-add-button. Production allowlist: webapp/src/features/albums/albums.css. No JS/API/ACL/media/storage/data/dependency/deploy changes.

Reproduced in actual App selected-family harness: Feed central Add renders its local drawer, but central Add from Albums mounts App's shared ComposerHost outside .albums-surface. The fixed host is z65; the portalled drawer is z50. The earlier album-local selector does not match this global host. DOM visibility/clickability alone missed the paint occlusion; screenshot before.png shows only the empty host.

Plan: delegate one CSS selector correction so the portalled drawer appears above either active ComposerHost. Keep ordinary Feed behavior and album-local upload, receipt/form styling and cancellation unchanged. Do not modify ComposerHost behavior or upload semantics.

Acceptance: mobile WebKit actual App, central Add from Feed and Albums (also Family/Gifts global callers), visible chooser screenshot and photo filechooser selection; cancel return; album-local upload chooser remains usable. Use a short external synthetic browser probe, production build and diffcheck; no repeated FULL per owner's latest minimal-check instruction. Fresh independent review, actual diff inspection and exact tree verification before/after squash. Deliver through guarded FRONTEND lane with all host/recovery/service-retention guards. Stop and report if change needs sensitive behavior, schema, contracts or deployment policy changes. No production user-data mutation for acceptance.
