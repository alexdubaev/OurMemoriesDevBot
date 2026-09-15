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
| MAX-07 | WAITING | First prove stable MAX-hosted video reference/retrieval on real MAX; do not store MAX video originals privately without a new owner decision |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. The owner-authorized MAX-06 probe used only read-only MAX API calls and unauthenticated reads of the exact synthetic media URLs returned by MAX. No token, Authorization header, signed media URL, personal media, or personal account data was recorded.

MAX-07 remains NOT STARTED. Do not begin it automatically. Its first separately authorized step must be a bounded real-MAX feasibility investigation proving stable MAX-hosted original-video reference, later retrieval/redelivery, and temporary-URL refresh. If that cannot be proven, STOP for owner adjudication; do not choose permanent Selectel/private video-original storage without separate approval. Do not advance to MAX-09 or MAX-10.
