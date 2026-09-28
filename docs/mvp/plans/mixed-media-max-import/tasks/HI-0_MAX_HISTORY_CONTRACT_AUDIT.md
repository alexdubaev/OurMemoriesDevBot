# HI-0 — MAX historical channel import contract + provider audit

Depends on: **MM-4 merged**

## Goal

Freeze the exact MAX history-import implementation contract against current MAX API/provider behavior and fresh memoLy code, so backend and UI can proceed in parallel.

This is a bounded discovery/contract task, not an open-ended research project.

## Verify current MAX capabilities

Using authoritative MAX documentation/current adapter behavior, establish:

- channel/message history endpoint;
- required bot/channel permissions;
- pagination model;
- chronological/reverse order behavior;
- timestamp field and unit;
- attachment representations;
- image/video resolution/download APIs;
- message identifiers and uniqueness scope;
- maximum page sizes;
- rate-limit behavior and retry signals;
- deleted/unavailable message behavior;
- bot admin requirement if applicable.

Record source links/versions in repo docs.

Do not rely on memory if provider docs differ.

## Freeze import API contract

Define minimal memoLy import workflow.

Recommended product contract:

1. owner/admin opens import action from an explicit family context;
2. target family is explicit;
3. target child is explicit;
4. source MAX channel is explicitly selected/identified through existing authorized integration;
5. optional preview/read-only scan may show count/date range;
6. owner starts import;
7. backend creates durable import job;
8. UI polls/statuses the job;
9. retry/resume does not duplicate.

Do not put provider secrets in browser payloads.

## Authorization

Default:
family owner only may start a historical channel import.

If fresh existing ACL has a more specific approved capability, reuse it.

Do not let a viewer start mass import.

## Source identity

Freeze the durable provider key used for dedupe.

Must use provider IDs (e.g. bot/channel/message identity), not caption/time heuristic.

## Time mapping

For every imported post:

- source provider timestamp → `sourcePublishedAt`;
- initial `occurredAt` → `sourcePublishedAt`;
- `firstPublishedAt` → memoLy publication time.

## Media mapping

- photo-only post → may remain legacy photo or new media, but contract must be consistent;
- video-only post → may remain legacy video or new media;
- mixed photo/video post → `kind=media`;
- attachment order exactly preserved.

Prefer minimal compatibility:
use `media` when mixed; keep existing one-type kinds where that avoids unnecessary churn.

## Backfill/import scope

No destructive rewriting of existing live-captured MAX Memories.

Importer must detect already-present source messages and skip/reconcile idempotently.

## Required deliverable

Commit a concise provider/import contract document plus any minimal shared types/contracts/tests needed to let HI-1 and HI-2 start independently.

## Escalation

Only escalate if provider limitations force a new product decision such as:
- impossible access to full channel history;
- inability to resolve video safely;
- ambiguous source identity;
- no safe family/child targeting.

Final HANDOFF title:

`HANDOFF — HI-0 MAX HISTORY IMPORT CONTRACT`
