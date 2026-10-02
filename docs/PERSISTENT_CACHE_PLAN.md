# PERSISTENT-UI-AND-MEDIA-PREVIEW-CACHE

Base: `283265ed743ddb744308c4eb296644468b7692d0`; branch: `feat/persistent-ui-media-cache`.

## Accepted implementation

1. Add a small browser-native IndexedDB adapter for dehydrated existing QueryClient data, with versioned per-authenticated-user namespaces. Never persist auth responses/tokens or use cached identity. Gate private rendering until hydration completes after authoritative auth. Mark restored queries stale for background revalidation. Serialize storage operations and generation-check identity/logout transitions to prevent late resurrection.
2. Represent existing family home/detail/member responses and selected-family presentation using existing DTOs and QueryClient keys; restore their React presentation state without waiting for server refresh. Preserve welcome/invite/install handling, membership epoch isolation and mutation refreshes. Never persist invite credentials or transient player state. A confirmed family denial or authoritative membership loss removes that family's query data and visual cache while retaining unrelated accessible families.
3. Reuse private-media service worker and/or private-image abstraction for bounded same-origin private image caching only. Explicit image purpose/eligible path plus response content-type and size validation are required. Identity derives only from authenticated app message, scoped by client ID; tokens stay in memory. No streams/audio/originals/Range/206/provider video caching. Reuse stable media IDs/variant URLs; cache quotas/age centralized. Logout and family cleanup must complete or fail closed; stale asynchronous writes cannot resurrect removed data.
4. For eligible private images only, authenticated ACL checks precede conditional 304. Use `private, no-cache` with stable revision validators. Video and other resources remain no-store. Long immutable cache applies only to truly fingerprinted static paths; HTML and service worker revalidate. Unversioned artwork revalidates unless a content-addressed deployment path is provided. No database changes.
5. Deterministic tests cover identity/auth gate, restore/revalidate, version discard, logout/session/family cleanup, retained other families, image hit/revision/eviction and video bypass. Browser tests use synthetic fixtures and persistent context across pages. Lead runs checks, then one independent read-only scoped reviewer; one bounded fix pass/recheck if needed.

## Scope / ownership

Single implementer allowed paths: webapp cache/auth/family/feed integration, tests and synthetic E2E fixtures; backend media transport and targeted tests; Selectel static Caddy template and header tests; this documentation. Lead accepts composition-root changes. Forbidden: Prisma/schema/migrations, shared DTO redesign, lockfile/new dependencies without ruling, provider playback internals, generated route tree, design/CSS/welcome changes, unrelated worktrees. Stop for missing posters requiring a new provider/transcoding architecture, security choices outside this ruling, or database changes.

## Verification / delivery

Run targeted tests, relevant webapp tests, affected backend/static tests, typecheck, lint, webapp build, architecture/template checks. Record counts and exit codes; no zero-test green. Read fresh main before publication; reconcile safely if changed. Push task branch, PR with required CI and scoped review, squash merge, then canonical Selectel release runbook. Verify runtime SHA, health, static/private image/video headers after deployment. Production fixtures must not use real private media or create user data.

Production baseline: running backend OCI revision equals base SHA; public HTML has ETag and no Cache-Control. GitHub and owner-provisioned SSH access verified read-only. Static container revision requires further inspection.

## MAX poster ruling

The current MAX DTO/component has no poster. The provider's official `GET /videos/{videoToken}` documents a nullable `thumbnail` image payload: https://dev.max.ru/docs-api/methods/GET/videos/-videoToken-/. A minimal image-only route derived from the existing playback path is accepted. Extend internal provider normalization/port with optional thumbnail metadata and reuse existing family/reference/message identity guards plus the strict existing image downloader host policy. Limit image bytes and MIME, never fetch video for poster generation. No database or public memory DTO changes. Supply the image to the existing player; retain canonical content/Range path and controls. When no thumbnail is supplied, retain current fallback behavior and document this limit. Provider adapter and internal media port edits for this bounded purpose are allowed; broader playback changes remain forbidden.
