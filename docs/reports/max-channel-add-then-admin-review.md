# MAX channel onboarding release review

Task: FIX-MAX-CHANNEL-ADD-THEN-ADMIN-ONBOARDING.
Base: decc5d45ec78b26d735e03894601ed63ff86141f.
Branch: fix/max-channel-add-then-admin-binding.

Production evidence establishes a successfully processed permissions event with a connected, unassociated channel. No bot-added event is persisted for that attempt, and the processed payload was cleared. Its historical actor and the reason for the missing bot-added event remain unknown. The original add-before-admin hypothesis is therefore not asserted as the production root cause. The owner-approved authenticated actor recovery covers this observed state without manual data repair.

The lead inspected the implementation diff and personally reran the final capture and forward integration suites: 100 and 18 passed, zero failed. The direct-video, media-flow and backup suites passed 21, 2 and 3 tests respectively, making 144 MAX integration tests. Backend unit tests passed 612, zero failed. Full typecheck, lint, architecture (793 source files), template and diff checks exited zero; backend typecheck was repeated after the final replacement fix.

Independent review found and resolved three P2 issues: ambiguous provider admin rows were accepted before validating the entire response; a combined lifecycle/forward fixture retained a historical Family association; and recovery replacement rejected a freshly verified permanent loss of old-channel permissions. The respective regression tests reproduced the problems and passed after correction. No P0/P1 findings were reported.

A final fresh independent reviewer inspected the whole active change without implementation history and returned production_ready with no findings. That reviewer independently ran both capture and forward integration files successfully. A prior reviewer integration attempt failed to connect to a skipped disposable database; it did not run tests and is not counted as passing evidence.

Authorization requires current linked actor identity, current active Full membership, server-side bot channel verification and, for explicit recovery, authoritative proof that the same actor administers the exact channel. Consent and callbacks are actor-bound. Callbacks repeat these checks and fence current channel/Family versions. Missing provenance, foreign association and stale removal fail closed. Recovery instructs the owner to forward again after connection; no Memory or original claim is created before consent, and forward import never queues a channel backup.

No schema, migration, public contract or deploy configuration changed. No production SQL repair, membership mutation or automatic Memory creation was performed. Required CI on the actual PR head remains a separate merge gate. The owner explicitly authorized squash merge and canonical production deployment; owner MAX acceptance follows deployment.
