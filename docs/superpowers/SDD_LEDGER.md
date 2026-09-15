# memoLy MAX SDD Ledger

Updated: 2026-09-15

| Task | Status | Note |
|---|---|---|
| MAX-01 | APPROVED | Provider enablement and startup isolation |
| MAX-02 | APPROVED | MAX identity persistence and Mini App authentication |
| MAX-03 | APPROVED | Provider-neutral HostBridge and MAX auth bootstrap |
| MAX-04 | APPROVED | MAX API client, bot identity, and webhook boundary |
| MAX-05 | APPROVED | Durable text ingestion and retry-safe responses |
| MAX-06 | APPROVED | Direct-dialog image capture is implemented and reviewed for both proven flows: 1–10 ordered `type=image` attachments become one photo Memory using exact MAX rendition bytes; one validated image `type=file` becomes one photo Memory using exact delivered file bytes. The 1–10 rule is a memoLy application limit, not an official MAX guarantee. |
| MAX-07 | IN_PROGRESS — VIDEO | Owner approved MAX-hosted video for MVP: memoLy persists only a stable provider reference and resolves current transport data for guarded playback. No MAX video original is copied to private storage. Audio/voice remains separate and not started. |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. The owner-authorized MAX-06 probe used only read-only MAX API calls and unauthenticated reads of the exact synthetic media URLs returned by MAX. No token, Authorization header, signed media URL, personal media, or personal account data was recorded.

MAX-07 VIDEO implementation was explicitly unblocked by the owner on 2026-09-15. The owner accepts the MVP risk that MAX does not currently provide a proven, documented indefinite archival-retention guarantee. The 24-hour and seven-day retention checks are informational and do not block implementation, review, or the MVP roadmap. The approved design is recorded in `docs/superpowers/specs/2026-09-15-max-07-video-reference-design.md`; the bounded implementation brief is `docs/superpowers/plans/2026-09-15-max-07-video-reference.md`. Do not advance to audio/voice until VIDEO reaches APPROVED, and do not advance to MAX-09 or MAX-10 automatically.
