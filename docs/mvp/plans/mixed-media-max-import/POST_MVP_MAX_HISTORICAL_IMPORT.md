# POST-MVP: MAX Historical Import

## Scope and status

The owner deferred historical MAX channel import until **after MVP**. It is **not an MVP release blocker**. Mixed-media MM-0…MM-4 is complete. HI-0…HI-4 have status **`DEFERRED_POST_MVP`**: HI-0 has a partial documentary audit, while HI-1…HI-4 have not started. The [HI-0 audit](tasks/HI-0_MAX_HISTORY_CONTRACT_AUDIT.md) preserves the dated 30-category evidence matrix. Its provisional HI-1/HI-2 API is **NOT FROZEN**. No controlled MAX provider validation or real history import has been performed for this plan.

The current MVP scope includes Web/PWA creation, live MAX ingestion, mixed media, the Feed carousel, and new incoming Memories. Migration of a full old-channel archive is **not** an MVP release requirement.

## Open blockers before implementation contracts can freeze

1. Confirm bot access to posts published before it joined the channel.
2. Demonstrate pagination without gaps across the full accessible history.
3. Define and prove a safe durable checkpoint for restart/resume.
4. Prove page-boundary completeness for multiple posts with the same timestamp.
5. Establish the scope and uniqueness of `chat_id`, `mid`, and `seq`.
6. Confirm historical mixed photo/video attachment ordering matches authored/display order.
7. Confirm how old photos and videos can be downloaded safely.
8. Confirm re-resolution of old video/media tokens and URLs after expiry or failure.
9. Decide the channel-history provenance model.
10. Decide a single live/history dedupe identity for the same source post.
11. Adapt or extend `MaxSource` only after validating its dialog-oriented model for channels; do not silently weaken its constraints or invent a parallel identity system.
12. Freeze the HI-1/HI-2 backend and UI contracts only after the preceding provider evidence and architecture decisions are resolved.

The first eight require controlled synthetic-channel evidence. Items 9–11 require an explicit architecture ruling informed by that evidence. Item 12 is the resulting contract gate. If no deterministic no-gap traversal or safe source identity is demonstrable, stop and escalate rather than claiming complete import.

## Post-MVP sequence

1. **HI-0:** Run controlled provider validation on a synthetic channel; record redacted evidence for the blockers above. Resolve channel provenance, live/history dedupe and `MaxSource` architecture. Then freeze the provider behavior and shared HI-1/HI-2 API/UX contract. The existing documentary audit alone does not complete HI-0.
2. **HI-1 + HI-2:** Build the durable backend import job and owner UI workflow in parallel only after HI-0 freezes the contract. Reconcile both to the same interfaces before merge.
3. **HI-3:** Transfer media and publish one Memory per source post, preserving order, source time and idempotency after the backend foundation is ready.
4. **HI-4:** Prove the end-to-end owner workflow, interruption/resume, dedupe, temporal fidelity, media failures, ACL and feed rendering with synthetic/test-channel data.
5. **Separate production rollout:** Plan, review and execute deployment as its own release task. Completion of HI-4 alone does not authorize deployment.
6. **Explicitly authorized real import:** Obtain specific owner authorization for the real source channel, target family/child and import run. No task in this pack authorizes importing real family history by itself.

See the [dependency plan](03_DEPENDENCY_AND_PARALLEL_PLAN.md), [acceptance matrix](05_ACCEPTANCE_MATRIX.md) and individual [HI-0](tasks/HI-0_MAX_HISTORY_CONTRACT_AUDIT.md), [HI-1](tasks/HI-1_IMPORT_JOB_BACKEND.md), [HI-2](tasks/HI-2_IMPORT_UI_WORKFLOW.md), [HI-3](tasks/HI-3_IMPORT_MEDIA_PUBLICATION.md), [HI-4](tasks/HI-4_HISTORY_IMPORT_E2E.md) task briefs.

## HOW TO RESUME AFTER MVP

1. Assign HI-0 as a new post-MVP task from current accepted `origin/main`, in its own branch/worktree. Re-read current MAX documentation and adapter behavior; do not assume the 2026-09-28 audit is still current.
2. Prepare a controlled synthetic channel and explicit validation permissions. Record safe, redacted provider request/response observations, including pagination boundaries, access scope, identity and media lifetime.
3. Have the lead resolve items 9–11 above and approve a precise provider traversal and no-duplicate contract. Update HI-0 evidence and freeze HI-1/HI-2 interfaces only when all blockers have answers.
4. Assign HI-1/HI-2, then HI-3/HI-4 in dependency order with their own checks, review and merge. Follow with a separate release task and a separately authorized real import.
