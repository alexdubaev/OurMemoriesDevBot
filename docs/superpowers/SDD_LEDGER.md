# memoLy MAX SDD Ledger

Updated: 2026-09-15

| Task | Status | Note |
|---|---|---|
| MAX-01 | APPROVED | Provider enablement and startup isolation |
| MAX-02 | APPROVED | MAX identity persistence and Mini App authentication |
| MAX-03 | APPROVED | Provider-neutral HostBridge and MAX auth bootstrap |
| MAX-04 | APPROVED | MAX API client, bot identity, and webhook boundary |
| MAX-05 | APPROVED | Durable text ingestion and retry-safe responses |
| MAX-06 | WAITING_FOR_LIVE_PROBE | 2026-09-15 bounded auth diagnostic: approved Selectel secret file is non-empty, 168 bytes, mode 0600, UTF-8, with no leading/trailing whitespace, CR, LF, or NUL; exact raw-token Authorization construction produced `GET /me` 401 and `GET /subscriptions` 401. Owner must replace the invalid/revoked/wrong server-side token without sharing it in chat, then resume the unchanged probe from the auth gate |
| MAX-07 | WAITING | First prove stable MAX-hosted video reference/retrieval on real MAX; do not store MAX video originals privately without a new owner decision |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. Owner-authorized read-only MAX-06 calls were limited to two `GET /subscriptions` attempts and one `GET /me`; all returned HTTP 401. No updates, messages, media, or mutation endpoint was called.

The next action is to replace the rejected credential in the approved server-side secret source and resume the unchanged MAX-06 synthetic live image probe from `GET /me`, then `GET /subscriptions`. Do not advance to MAX-07, MAX-09, or MAX-10.
