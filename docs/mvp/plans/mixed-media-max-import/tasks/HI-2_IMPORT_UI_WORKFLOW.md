# HI-2 — MAX historical import UI workflow

**Status: `DEFERRED_POST_MVP` (not started).** Historical import is not an MVP release blocker. Start only after HI-0 controlled provider validation and architecture/API contract are resolved; see [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on: **HI-0 validated and contract frozen after MVP**

May run in parallel with: HI-1.

## Goal

Add an owner-facing memoLy UI flow to import old MAX channel history into an explicit family/child context.

## Placement

Use current memoLy navigation/settings/family context conventions.

Do not create a separate admin web application.

Exact placement should be derived from fresh UI architecture with minimal disruption.

## Owner flow

Minimum:

1. open import action;
2. confirm target family;
3. choose target child if required;
4. identify/select connected MAX channel according to HI-0 contract;
5. show clear explanation:
   - imports historical posts;
   - source dates preserved;
   - reruns do not duplicate;
6. start;
7. show progress;
8. show completion/skipped/failure summary;
9. allow safe retry/resume where backend permits.

## Safety

Do not show:
- bot token;
- webhook secret;
- raw provider credentials;
- private internal IDs unnecessarily.

Do not let viewer/non-authorized user start import.

## UX

This is a potentially long-running job.

Do not block the entire app on an open modal until completion.

User can leave and later return to job status if backend persists it.

Do not invent background push notifications in this stage.

## Tests

- owner sees action;
- unauthorized member does not;
- explicit family/child target;
- start uses correct contract;
- progress rendering;
- transient error/retry;
- completed summary;
- navigate away/back;
- no duplicate start from double click;
- accessibility and themes.

## Parallel development note

HI-0 freezes API contract.

While HI-1 is being implemented, this branch may use typed test fixtures/mocks, but final merged code must use actual shared contracts and fresh-main reconciliation.

## Scope

No provider traversal logic in browser.
No direct browser MAX history fetch.
No secrets client-side.
No production deploy.

Final HANDOFF title:

`HANDOFF — HI-2 MAX HISTORY IMPORT UI`
