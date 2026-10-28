# MAX family notifications

Owner decision, 2026-10-28: expand the released #257 pilot to all eligible members of the event's family, including its author. This supersedes #257's owner-only rollout restriction for this follow-up task. The two events, private-content restrictions and existing publication/album transaction boundaries remain unchanged.

## Scope and implementation

`MAX_NOTIFICATIONS_AUDIENCE=owner|family` selects the audience; omitted means `owner` for compatibility with the released pilot. `MAX_NOTIFICATIONS_PILOT_ENABLED` remains the master switch and defaults to false. The existing `MAX_NOTIFICATIONS_PILOT_SINCE` is the activation generation. Keeping these deployed switch names avoids a second sending path. In owner mode, the single protected Control owner and pinned subject remain mandatory. Family mode uses actual family membership and MAX identities; Control owner status is not an eligibility rule.

Family mode selects active full members and viewers, including the actor, with an active user, exactly one MAX ExternalIdentity and successful bot-start welcome evidence. A stopped bot, missing/ambiguous identity, revoked membership or inactive family/user excludes that recipient. No user outside the event's family is eligible. There is no global broadcast and no notification for merely joining a family.

One committed event creates one TaskOutbox row per eligible identity in the same transaction as the album/publication writes. The dedupe key includes the existing stable event identity and recipient identity. Each row independently retries and finishes/redacts: an outage for one recipient cannot resend completed deliveries to others. Existing task type and provider adapter are retained; no schema or settings screen is added.

Delivery rechecks the exact identity, subject hash, membership epoch, family/user state, bot engagement and actual bot identity immediately before sending. Existing per-dialog advisory locking/spacing remains; provider I/O takes no family row lock. An audience or activation-generation mismatch skips queued work. Missing audience in an older payload means owner mode, so switching to family mode cannot expand old queued events. Events saved while disabled or before rollout are never backfilled.

Messages and the single `Открыть memoLy` button are unchanged. Album titles come from persisted albums; feed text exposes only the publication kind. No private content, media, filenames or storage links are sent. MAX acceptance is not physical-device confirmation, and a lost response after provider acceptance can still make transport delivery ambiguous.

## Checks and release

Task `MEMOLY-MAX-FAMILY-NOTIFICATIONS`; accepted base/production backend/frontend `76b31d275344145446780fdc7416ce275fbf7836`; branch `feat/max-family-notifications`; worktree `D:/codex/TG_OurMemoriesDevBot/worktrees/max-family-notifications`.

Affected checks: existing real PostgreSQL notification suite plus multi-recipient feed/album, actor/viewer inclusion, outsider/ambiguous/inactive exclusions, concurrent replay, per-recipient revocation and retry, and audience/generation/disable transitions. Preserve existing legacy owner tests and the current → frozen d299 → current recovery probe. Register only the measured source fingerprint for the existing recovery pair, with source-drift rejection. Use one final FULL and one scoped independent review, then squash/guarded full deployment, smoke and recovery readiness.

Before rollout inspect actual running SHAs, accumulated diff, free disk space and host release lock. Verify the expected MAX bot and existing webhook subscription including `bot_stopped`. `bun scripts/max-notifications-pilot.ts` is read-only and reports only audience, verification booleans and eligible counts; it sends nothing. The old filename is retained for operator compatibility.

In protected `/opt/memoly/env/backend.env`, set `MAX_NOTIFICATIONS_AUDIENCE=family`, keep the master switch true, and rotate SINCE to a fresh current UTC instant. Apply through the standard guarded release so API/worker/scheduler share the configuration. Do not create synthetic production family data or send bulk test messages. Observe ordinary new events only; physical receipt/button acceptance requires real user evidence.

Disable all event notifications with `MAX_NOTIFICATIONS_PILOT_ENABLED=false` and the guarded update. To return to the owner-only pilot, set audience `owner`, verify the protected owner/subject and rotate SINCE before the guarded update. Re-enabling either audience always uses a fresh generation; pending earlier work must not be replayed.
