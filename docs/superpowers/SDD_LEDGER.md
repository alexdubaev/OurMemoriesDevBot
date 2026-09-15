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
| MAX-07 | APPROVED WITH EXPLICIT MVP LIMITATION | MAX-hosted video is supported through a stable provider reference and guarded fresh-resolution playback. Native MAX voice is unsupported because its live event exposed no message, body, mid, attachment, or stable media identity. Ordinary attached MP3/M4A is undecided and optional; Telegram voice is unchanged. |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. The owner-authorized MAX-06 probe used only read-only MAX API calls and unauthenticated reads of the exact synthetic media URLs returned by MAX. No token, Authorization header, signed media URL, personal media, or personal account data was recorded.

MAX-07 VIDEO implementation was explicitly unblocked by the owner on 2026-09-15. The owner accepts the MVP risk that MAX does not currently provide a proven, documented indefinite archival-retention guarantee. The 24-hour and seven-day retention checks are informational and do not block implementation, review, or the MVP roadmap. The approved design is recorded in `docs/superpowers/specs/2026-09-15-max-07-video-reference-design.md`; the bounded implementation brief is `docs/superpowers/plans/2026-09-15-max-07-video-reference.md`.

VIDEO reached APPROVED at local head `c225dc588f8a1a8034f5fb807e94ecc90334f798` after clean-database migration and integration verification, backend/contract/UI gates, one independent review/fix pass, and a second fresh whole-change review/fix pass. The accepted implementation stores only stable `{mid, payload.id, attachment position, type=video}` identity and resolves fresh transport data behind memoLy authorization. Video semantics do not apply to audio/voice.

The bounded audio/voice investigation is recorded in `docs/superpowers/specs/2026-09-15-max-07-audio-voice-contract-investigation.md`. The owner corrected and independently verified the authoritative staging ED25519 fingerprint; the read-only probe then completed without changing subscriptions or webhooks. The single synthetic native-voice event had only `timestamp`, `update_type`, and `user_locale`, leaving no `mid` for `GET /messages` and no safe identity/retrieval contract. The owner accepted this boundary on 2026-09-15: native MAX voice is unsupported in MVP, generic attached MP3/M4A remains an optional follow-up, and Telegram voice is unchanged. This limitation is not a P0/P1/P2 blocker. MAX-07 is APPROVED WITH EXPLICIT MVP LIMITATION. Do not start MAX-10 automatically.
