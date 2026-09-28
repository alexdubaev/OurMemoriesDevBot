# HI-4 — MAX historical import end-to-end reconciliation

**Status: `DEFERRED_POST_MVP` (not started).** Historical import is not an MVP release blocker. See [the post-MVP roadmap](../POST_MVP_MAX_HISTORICAL_IMPORT.md).

Depends on:
- HI-1 merged
- HI-2 merged
- HI-3 merged
- MM-4 merged

## Goal

Prove the complete historical import product flow before release.

## Synthetic/test-channel fixture

Use a controlled provider fixture/test adapter containing at least:

1. text-only post;
2. single photo;
3. multi-photo;
4. single video;
5. two photos + two videos;
6. alternating photo/video;
7. long caption within limit;
8. source post already live-captured;
9. transient media failure;
10. enough posts to force pagination.

## Required end-to-end proof

Owner:
- selects target family/child;
- starts import;
- sees progress;
- job survives interruption;
- resumes;
- finishes.

Result:
- source post count maps correctly;
- no duplicates;
- mixed post = one Memory;
- order exact;
- sourcePublishedAt exact;
- occurredAt initial exact;
- firstPublishedAt memoLy-side;
- Feed mixed carousel renders;
- unread/seen remains one unit;
- existing live Memory not duplicated.

Second import of same history:
- imports zero duplicates;
- reports skipped/already imported coherently.

## Security

- viewer denied;
- wrong family denied;
- source/media cannot cross family;
- provider secrets absent from client/log evidence.

## Performance/operability

Measure/observe enough to catch:
- unbounded concurrency;
- API rate-limit storms;
- all-video eager downloads;
- memory growth over long history;
- giant DB transaction across entire channel.

Import should use bounded page/post/media concurrency.

Do not require one transaction for whole history.

## Final independent Luna review

Focus:
- idempotency;
- source identity;
- temporal fidelity;
- attachment order;
- provider retry;
- family ACL;
- mixed carousel;
- no historical duplicates;
- no source-secret leak;
- no giant transaction;
- legacy regression.

P0/P1/P2 = 0.

## Release boundary

This task is code/test/reconciliation only unless separately authorized.

After merge, create a separate production rollout task.

Final HANDOFF title:

`HANDOFF — HI-4 MAX HISTORY IMPORT READY FOR RELEASE`
