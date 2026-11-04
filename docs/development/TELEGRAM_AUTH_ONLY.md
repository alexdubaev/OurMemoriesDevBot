# Telegram Mini App authentication only

The existing `POST /api/v1/auth/telegram` exchanges signed Telegram initData for the normal
memoLy session. Set `TELEGRAM_AUTH_BOT_TOKEN` to the existing bot's protected server token
and explicitly set `TELEGRAM_ENABLED=false`. Keep `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_INBOX_ENCRYPTION_KEY` absent from the runtime env.
Preserve their protected source for recovery; do not delete or disclose secret values.

The auth-only key is optional. Empty means unset. Auth resolves this key, then the legacy
`TELEGRAM_BOT_TOKEN`; if neither exists, signed exchange remains closed. If both are set,
they must match. The legacy token still requires the enabled message-bot configuration.
The new key does not change `TELEGRAM_ENABLED`, its defaults, or its validation rules.

With the message bot disabled, backend startup does not call Telegram `getMe`, mount
webhook routes, or start polling. Worker startup sees no legacy token and skips its Telegram
identity check; the existing task adapter still requires message-bot credentials.
Auth-only login performs local HMAC verification, freshness and replay
checks; it needs no Telegram API connection, webhook, inbox encryption key or bot message.

Telegram and MAX identities remain separate, including identical numeric subjects. Login
does not link accounts or grant memberships. Each request applies existing family roles,
revocation and private photo/MAX-video permissions. Refresh sessions and HttpOnly cookies
use the existing implementation. Provider URLs stay server-side.

Before a full-service release, run the canonical FULL gate and independent review for the
exact candidate source under `AGENTS.md`, `docs/DEPLOYMENT.md` and the Selectel runbook.
Keep their host lock, immutable image, backup/readiness and recovery safeguards. This
change adds no migration. Preserve the protected previous env and verify that the actual
designated recovery image accepts the new optional key while its message bot stays off;
an old runtime ignores that key and cannot perform the restored auth-only login. Recovery
must retain the accepted UI and data compatibility. Do not move the new value into the
legacy key while the message bot is disabled: old-runtime validation rejects that setup.

## Isolated checks

Use only matching `DATABASE_URL` and `TEST_DATABASE_URL` pointing to an owned loopback
PostgreSQL database named `*_test`. Set `NODE_ENV=test`, `TEST_SKIP_DOCKER=1` and
`E2E_SKIP_DOCKER=1` for an already running owned PostgreSQL instance. Supply only synthetic
secrets. Generate Prisma and apply existing migrations to that test database first:

```sh
bun run --cwd backend prisma:generate
bun run --cwd backend prisma:deploy
bun test backend/src/telegram-auth-only.test.ts backend/src/modules/auth/infrastructure/telegram-init-data.test.ts
bun run --cwd backend test:integration -- src/modules/auth/telegram-auth.integration.test.ts
bun run --cwd backend typecheck
bunx --no-install playwright test --config webapp/e2e/telegram-auth-only.playwright.config.ts
```

The dedicated browser config starts real React and HTTP routes with real PostgreSQL
sessions/membership and local private photo storage. Only the MAX API/rendition CDN is
synthetic; MP4 bytes use `backend/src/modules/auth/test-support/telegram-playback-av.mp4`
with Range/HEAD support. This five-second H.264/AAC fixture is a generated solid colour and
440 Hz tone, contains no user data, and needs no external service. It was generated with
the already available ffmpeg (`color=c=0x8fbec4:s=240x320:r=15`,
`sine=frequency=440:sample_rate=44100`, `-t 5 -c:v libx264 -pix_fmt yuv420p -c:a aac
-b:a 48k -movflags +faststart`).
The browser executes Telegram host exchange, opens the family feed/photo carousel, then
plays, pauses, seeks and resumes MAX video using normal media authorization; Chromium
must decode audio bytes while the element is unmuted. This does not verify physical
speaker output. A test-only
loopback server cleanup route disposes this fixture before Windows process termination.
It is never mounted by production. No production families or memberships are created.

## Live acceptance boundaries

The synthetic desktop browser journey does not establish a real Telegram Desktop or
physical iPhone result. After guarded promotion, verify actual runtime readiness and
launch the existing Main Mini App in Telegram without sending `/start` or other messages.
Check production photos/MAX video only through a real user's existing lawful membership.
If that Telegram identity has no family membership, report that acceptance limitation;
do not provision access or merge it with a MAX account.

The owner updated the Main Mini App URL. The separately configured bot menu button was
observed pointing to the old stand during discovery; it remains unchanged by this task.
Changing it requires separate authorization. No webhook, bot configuration or messages
are part of this implementation.
