# memoLy MAX SDD Ledger

Updated: 2026-09-15

| Task | Status | Note |
|---|---|---|
| MAX-01 | APPROVED | Provider enablement and startup isolation |
| MAX-02 | APPROVED | MAX identity persistence and Mini App authentication |
| MAX-03 | APPROVED | Provider-neutral HostBridge and MAX auth bootstrap |
| MAX-04 | APPROVED | MAX API client, bot identity, and webhook boundary |
| MAX-05 | APPROVED | Durable text ingestion and retry-safe responses |
| MAX-06 | IN_PROGRESS | Image capture design brief owner-approved. The 1–10 `type=image` count is a memoLy application limit, not an official MAX inbound guarantee. Both native flows are in scope: exact MAX rendition bytes for quick images and exact validated image-file bytes for one `type=file` attachment per message. Implementation planning is active; MAX-07 remains excluded. |
| MAX-07 | WAITING | First prove stable MAX-hosted video reference/retrieval on real MAX; do not store MAX video originals privately without a new owner decision |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. The owner-authorized MAX-06 probe used only read-only MAX API calls and unauthenticated reads of the exact synthetic media URLs returned by MAX. No token, Authorization header, signed media URL, personal media, or personal account data was recorded.

The next action is the bounded MAX-06 TDD implementation and review workflow defined by the approved design. Do not advance to MAX-07, MAX-09, or MAX-10.
