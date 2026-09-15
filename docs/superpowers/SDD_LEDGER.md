# memoLy MAX SDD Ledger

Updated: 2026-09-15

| Task | Status | Note |
|---|---|---|
| MAX-01 | APPROVED | Provider enablement and startup isolation |
| MAX-02 | APPROVED | MAX identity persistence and Mini App authentication |
| MAX-03 | APPROVED | Provider-neutral HostBridge and MAX auth bootstrap |
| MAX-04 | APPROVED | MAX API client, bot identity, and webhook boundary |
| MAX-05 | APPROVED | Durable text ingestion and retry-safe responses |
| MAX-06 | WAITING_FOR_LIVE_PROBE | Approved Selectel secret source exists, but the 2026-09-15 first-gate `GET /subscriptions` returned HTTP 401; no later probe calls ran. Owner must validate or replace the server-side credential without sharing it in chat, then resume the unchanged probe from `GET /subscriptions` |
| MAX-07 | WAITING | First prove stable MAX-hosted video reference/retrieval on real MAX; do not store MAX video originals privately without a new owner decision |
| MAX-08 | APPROVED | MAX invite links, signed start routing, and provider-neutral Core invite reuse; local verification and two fresh whole-change reviews completed |

Publication state: local only. No push, PR, merge, deployment, webhook registration, or subscription mutation occurred. The only live MAX call was the owner-authorized read-only MAX-06 gate `GET /subscriptions`, which returned HTTP 401; no later probe call ran.

The next action is to validate the approved server-side MAX credential and resume the unchanged MAX-06 synthetic live image probe from `GET /subscriptions`. Do not advance to MAX-07, MAX-09, or MAX-10.
