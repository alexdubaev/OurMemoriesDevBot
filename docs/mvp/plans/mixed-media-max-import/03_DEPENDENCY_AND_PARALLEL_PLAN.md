# Dependency and parallel execution plan

**Current status:** MM-0…MM-4 complete. HI-0…HI-4 `DEFERRED_POST_MVP`; historical import is not an MVP release blocker. HI-0 has a partial documentary audit only, and HI-1…HI-4 have not started. Resume through [the post-MVP roadmap](POST_MVP_MAX_HISTORICAL_IMPORT.md).

## Guiding rule

Parallelize only when agents can work on genuinely separate paths/contracts without creating migration/schema/central-component collisions.

Do not run several agents concurrently just to appear faster.

## Stage 1 — mixed-media foundation (complete)

### MM-0 — Domain + temporal foundation
**Must run first.**

Owns:

- schema/migration;
- `MemoryKind.media`;
- temporal fields/invariants;
- contracts;
- core repository/publish invariants.

No other implementation task should merge before MM-0 establishes the final contract.

After MM-0 merges, the following may run in parallel:

### MM-1 — Web create/edit mixed media
Main area:
- composer;
- upload orchestration;
- API client;
- composer tests.

### MM-2 — MAX live mixed-message ingestion
Main area:
- MAX policies/processors/source mapping;
- source attachment ordering;
- MAX ingestion tests.

### MM-3 — Feed carousel + mixed presentation
Main area:
- Feed/presentation;
- Embla integration;
- mixed photo/video slide lifecycle;
- detail/fullscreen integration;
- B6 seen integration.

These three are intentionally separable after MM-0.

Potential collision caution:
- shared contracts may only be changed by MM-0 unless a proven defect requires a bounded follow-up;
- MM-3 owns shared media presentation components;
- MM-1 must not create a competing carousel;
- MM-2 must not redesign feed components.

### MM-4 — Mixed-media integration reconciliation
Runs only after MM-1, MM-2, MM-3 are merged.

Owns:

- fresh-main integration;
- cross-path E2E;
- legacy compatibility;
- no-regression verification;
- any small bounded glue fixes;
- final mixed-media stage review.

No historical import before MM-4 is merged.

---

## Stage 2 — MAX historical channel import (`DEFERRED_POST_MVP`)

### HI-0 — Historical import contract + provider capability audit
Resumes after MVP; MM-4 is complete. The documentary audit is partial and the provider contract is **NOT FROZEN**.

This is implementation-oriented discovery, not an endless design phase.

It must:

- re-check current MAX history APIs and permissions;
- freeze exact pagination/rate-limit/provider semantics in repo docs/tests;
- map source post identity and timestamp;
- resolve existing family/child selection flow reuse;
- freeze import job API contract.

HI-0 may make a small code/contracts PR if necessary, but should not build the full importer.

After post-MVP HI-0 validation, architecture resolution, and frozen contract:

### HI-1 — Backend import job + durable provider traversal
May run in parallel with HI-2.

Main area:
- backend import job state;
- MAX history fetch/pagination;
- idempotent source reservation;
- resume/retry;
- progress/status;
- security/ACL.

### HI-2 — Import UI / owner workflow
May run in parallel with HI-1 after HI-0 freezes API/UX contract.

Main area:
- current memoLy settings/family context UI;
- target family/child selection;
- import start/progress/error/completion presentation;
- no provider secrets in browser.

It may mock/fake backend responses only in tests while HI-1 is in progress; final branch must reconcile to real contracts before merge.

### HI-3 — Media transfer + publish integration
Runs after HI-1 and MM-4; may begin late in parallel with HI-2 if interfaces are stable.

Owns:

- importing each source post to one Memory;
- image/video transfer;
- mixed attachment order;
- `sourcePublishedAt`;
- initial `occurredAt`;
- one `firstPublishedAt` at memoLy publication;
- durable dedupe;
- retry after partial provider/media failures.

### HI-4 — Import end-to-end reconciliation
Runs after HI-1, HI-2, HI-3.

Owns:

- full synthetic/test-channel import;
- rerun idempotency;
- interruption/resume;
- mixed post fidelity;
- time fidelity;
- rate-limit/retry;
- owner-only authorization;
- final release readiness.

---

## Parallel schedule summary

```text
MM-0 [complete]
 ├── MM-1  ─┐
 ├── MM-2  ─┼── MM-4 [complete]
 └── MM-3  ─┘
              ↓
         AFTER MVP: HI-0 [deferred; validation/architecture gate]
             ├── HI-1 ─┐
             └── HI-2  │
                 HI-3 ─┼── HI-4 → separate production rollout → authorized real import
                       ┘
```

## What must not be parallelized

Do not concurrently run:

- two schema/migration owners;
- two agents refactoring the same Feed carousel core;
- import publication semantics before mixed-media contract is stable;
- production rollout while implementation branches are still changing target semantics.

## Merge discipline

Each task is independently merged when:

- acceptance is complete;
- proportional tests pass;
- `verify-required` passes on final HEAD;
- Luna High review is clean with P0/P1/P2 = 0;
- fresh-main reconciliation is complete;
- PR is mergeable;
- no new escalation category exists.

Agents do not wait for the owner merely to say “merge”.
