# HI-1 — MAX historical import job backend

**Status: `DEFERRED_POST_MVP` (not started).** Historical import is not an MVP release blocker. Start only after HI-0 controlled provider validation and architecture/API contract are resolved; see [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on: **HI-0 validated and contract frozen after MVP**

May run in parallel with: HI-2.

## Goal

Implement durable, owner-authorized, resumable historical MAX channel traversal and import-job state.

This task owns job orchestration/provider pagination, not final UI.

## Job properties

Need durable state sufficient for:

- family;
- child;
- initiating user;
- source channel/provider identity;
- status;
- cursor/checkpoint;
- counters;
- started/completed timestamps;
- bounded last error;
- retry/resume.

Do not store provider secrets unnecessarily.

Use existing encrypted/provider auth conventions.

## Authorization

Only approved family capability from HI-0.

Server derives actor from authenticated principal.

No client-supplied arbitrary owner identity.

## Traversal

- fetch provider history page-by-page;
- deterministic checkpoint;
- bounded retries/backoff;
- respect rate-limit/provider errors;
- resumable after worker/process restart;
- cancellation only if current product/runbook supports it cleanly; do not add a huge job-control framework.

## Idempotency

Provider post reservation must be durable before media publication work.

Re-running:
- skips already imported source posts;
- resumes incomplete ones;
- never duplicates complete Memories.

Reuse/extend `MaxSource` where safe instead of creating parallel identity systems.

## Progress

Expose minimal job status DTO:
- state;
- scanned/imported/skipped/failed counts;
- current progress/date/cursor as safe product data;
- bounded error summary.

No provider secrets/raw encrypted payloads in DTO.

## Read-only preview

If HI-0 contract includes a preview scan, implement it without mutating Memories.

Avoid scanning huge history repeatedly if durable metadata can be reused safely.

## Tests

- owner starts;
- viewer denied;
- explicit family/child;
- pagination;
- restart/resume;
- rate limit;
- transient failure;
- duplicate start/retry idempotency;
- existing live-captured source message skipped/reconciled;
- source timestamp retained for downstream;
- no secret leakage.

## Scope

Do not implement Feed carousel.
Do not build the UI beyond API contracts.
Do not deploy production.

Final HANDOFF title:

`HANDOFF — HI-1 MAX HISTORY IMPORT JOB BACKEND`
