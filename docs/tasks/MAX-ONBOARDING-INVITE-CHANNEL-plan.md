# MAX-ONBOARDING-INVITE-CHANNEL implementation plan

Base: 5c4264b9d1884503c84d582d975a594570fd8a61
Branch: feat/max-onboarding-invite-channel
Worktree: D:/codex/TG_OurMemoriesDevBot/worktrees/max-onboarding-invite-channel
Model: GPT-6 primary; scout/worker/reviewer delegated per teamlead-development.
User specification: supplied attachment, autonomous merge/deploy authorized. No real channel mutations for smoke.

1. Personal invitation entry (one worker): bot-start share link, detailed read-only invitation resolver, typed open_app adapter, encrypted durable invitation button context, outbox handoff, synthetic boundary/integration tests. Preserve authenticated preview/accept and callback buttons. No User/membership creation on bot_started. Official MAX start limit128; open_app payload uses existing invite_<token>.
2. Channel onboarding (subsequent worker): extract canonical CLI binding into reusable service; authoritative provider channel/admin/write check; lifecycle consumer; signed-int64/history/state; current Family capability; auto-first-bind, same-channel restore, actor-bound expiring selection/switch confirmation with revalidation and transactional race guard; reuse existing backlog queue. Minimal additive migration if necessary, no destructive backfill. Compact Family status contract/UI, viewer has no management CTA.
3. Lead final deterministic verification: contracts/typecheck/architecture/unit/integration/build and focused browser scenarios 320/390/430; synthetic materials only. Tests verify ACL/spoofing/races/lifecycle/idempotency plus live ingestion/backlog/self-loop regressions. Migration fresh and production-like upgrade validation.
4. Fresh independent read-only reviewer of whole change; delegate fixes then fresh review if significant. Final P0/P1/P2 zero. Lead checks actual diff/results.
5. Commit explicit paths; push canonical origin; PR template; required CI; reconcile fresh origin/main with merge if changed, repeat affected checks/review. Squash only green current-head required CI and clean review.
6. Canonical production deployment only: capture prior SHA/health/migrations/rollback readiness; verify deployed services SHA/health/DB/subscription/errors/bundle. No operator channel bind/rebind for smoke. Owner physical acceptance remains pending.

Allowed paths: backend/src/modules/max/**, backend/src/modules/families/**, backend/scripts/configure-max-backup-channel.ts, backend/prisma/schema.prisma and one/two additive migrations, backend runtime/worker composition if required; packages/contracts family status; webapp/src/platform/max-invite-link.ts and related MAX share tests; Family/settings UI, targeted tests; docs/tasks and handoff.
Forbidden: unrelated Feed/composer/reactions/Telegram/historical-import/registration redesign, secrets, production data mutation except canonical additive deploy migrations. Shared files have one delegated owner at a time.
STOP: unresolved security/ACL/provider-contract uncertainty, destructive migration, irrecoverable required CI, absent production access, unsafe release conflict. Do not claim physical MAX acceptance from automated tests.
