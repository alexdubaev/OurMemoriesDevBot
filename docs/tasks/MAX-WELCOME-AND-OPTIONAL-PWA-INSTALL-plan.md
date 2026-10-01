# MAX-WELCOME-AND-OPTIONAL-PWA-INSTALL

Task status: IN_PROGRESS
Base SHA: ed7fe4481f8564cea16a73060604e668d2b545e8
Branch: feat/max-welcome-optional-pwa
Worktree: D:/codex/TG_OurMemoriesDevBot/worktrees/max-welcome-optional-pwa

## Accepted scope and plan
1. Extend existing bot_started processing and outbox delivery. Use existing persisted welcome response rows as bot-specific interaction evidence, serialize subject classification in the same transaction, retain dedup/retry selection, and add official open_app buttons. Valid verified invite takes priority; preserve all canonical invite states and exact token. Service browser launches remain privileged. Do not use app welcomeShownAt/claimWelcome. No migration planned.
2. Capture install capability before React render. Add compact feed-only install/browser card and optional reopen in existing settings. Android MAX opens same-origin HTTPS through supported bridge on click with safe installation intention; browser uses deferred one-shot prompt only on click. iOS opens ordinary HTTPS. Keep browser identity/session/ACL authoritative and current BrowserLink approval. Persist only UX dismiss/intent, no secrets in URLs; restore authorized family navigation.
3. Test relevant bot/invite delivery, concurrency and retry; PWA event accepted/dismissed/error/missing, standalone/appinstalled, local dismissal, bridge failure/iOS, startup precedence and browser intent. Run scoped browser fixtures, typecheck/lint/build and architecture/template checks, then required CI for exact PR tree.
4. One fresh independent read-only reviewer; fix confirmed current-diff defects via executor and recheck affected tests only. Fresh main reconciliation, squash merge, canonical ci-release.sh under release lock, technical read-only smoke, owner handoff and stop.

## Ownership
Single delegated implementation executor, lead for architecture/verification/release, single read-only reviewer. No nested delegation.
Allowed: backend MAX process/deliver and scoped tests; webapp app/main/PWA/platform bridge, feed/settings integration, relevant CSS and fixtures/tests; this task report. No dependency/lockfile/CI changes, auth redesign, invite acceptance/ACL changes, channels, cleanup or unrelated refactors.

## Safety and acceptance
Disposable owned DB: memoly-max-welcome-test container; task/disposable labels; 127.0.0.1:55491; tmpfs only, no existing volumes. DATABASE_URL and TEST_DATABASE_URL explicitly set before bootstrap. Protected localhost:54329/web_app_demo and its resources untouched. No production user/family/invite test registrations, reset or seed. Production access, canonical origin, current runtime SHA and disk capacity checked read-only.
Stop only for access/required checks/data-risk/contract blocker. Physical Android/iOS installation and first welcome are owner acceptance after deployment, not claimed as automated PASS.
