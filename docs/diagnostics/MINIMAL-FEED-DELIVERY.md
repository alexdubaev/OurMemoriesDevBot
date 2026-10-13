# Minimal feed experiment delivery

## Owner-authorized root test

The owner subsequently confirmed that there are no other users and explicitly requested the temporary experiment at the ordinary `https://app.memoly.ru/` entry, followed by rollback on their request. This overrides the earlier prefix-only delivery restriction. The original static container and its files remain the rollback source; APIs, database, media access and workers remain unchanged.

The updated helper accepts `activate <full-sha> root` to serve the diagnostic document internally at `/`, preserving the browser URL, query and fragment for MAX/PWA launches. Prefix-only activation remains the default. `off` restores the canonical root; `status` reports both SHA and mode. Old artifacts without root support can still be selected in prefix mode. Root mode requires a fresh artifact and root-capable sidecar configuration.

The diagnostic entry now uses the existing MAX browser-link methods directly for code creation, status and redemption, so authentication stays on that page. MAX confirmation uses the existing signed challenge parser, forced host authentication and explicit approval action. No auth endpoint or protocol has changed. No rollback will run automatically while the owner is testing.

Root activation receipt, 2026-10-13 02:37 UTC:

- Active source/helper: `f6db4c15a5fe486a996fd298f27d511c18723a2e`, mode `root`. Root and prefix serve the same verified three-file artifact. Main has not been merged or published.
- `activate <sha> root`, `off`, and reactivation exited 0. Off restored the exact original root hash `c5fc47eab8bee445e945646f3e13a42030224763fb4a360d5ead5d14df59c88f`. Final state is root experiment active. Roll back on owner request with `sudo /opt/memoly/experiments/minimal-feed/minimal-feed-release.sh off`.
- Artifact SHA-256: HTML `8eeb85402fa6ed0015f6bc651fcfd32f7922e8df10b2f345c408e49df0e9842a`; JS `index-BImeQS-w.js` `08ce253faae74161840d5472866d8460dd9cddfbc982d6c0058f52700afda616`; CSS unchanged from initial release. Versioned helper `helper-f6db4c1.sh` hash `c0b077a3fe1b1020498a53faa282b65d7b9c401bc573a8436d4f8bf364c93e49`.
- Typecheck, isolated build/artifact guard, shell syntax and route/manifest closure passed. One focused real-backend browser pairing smoke passed (1/1, 33.4s): actual start/status/redeem, same diagnostic URL and family feed; approval state was seeded only in the test database, so live external MAX confirmation is still manual. One fresh independent review reported no P0/P1/P2 findings.
- Public browser smoke passed: ordinary root HTTP 200, no redirect, query/fragment preserved, plain MAX entry, exactly one diagnostic CSS, no page errors. Root uses no-store. Both existing workers and all five normal Compose container IDs/images stayed identical; health checks passed; no DB changes or migrations.
- Evidence: `.scratch/minimal-feed/root-{activate,rollback-reactivate,mode-closure}.log`, `root-production-after.txt`, `public-root-smoke.log`, `public-root.png`, `max-entry-auth-smoke.log`. Physical iPhone result remains pending; this delivery does not establish the white-screen cause.

The sections below record the initial prefix-only deployment, before the owner's root-test request.

This helper exposes the isolated UI at `https://app.memoly.ru/__experiments/minimal-feed/diagnostic.html` while leaving the normal `/` app, backend, database, and existing static container in place. It does not run a product release or migration.

Before activation, the operator stages the reviewed build under `/opt/memoly/experiments/minimal-feed/releases/<full-git-sha>/` with `dist/` and a standard `SHA256SUMS` file whose three entries are relative to that release directory (`dist/diagnostic.html`, one `dist/assets/index-*.js`, and one `dist/assets/diagnostic-feed-*.css`). All release paths and files must be root-owned and not writable by group or other users. The helper rejects symlinks, extra files, unexpected checksum entries, and checksum mismatches. It writes a root-only `release.env` with the source SHA, the immutable image ID captured from `memoly-static-1`, artifact hashes, and preparation time; the image ID is reused when that SHA is reactivated.

Install the versioned helper as `/opt/memoly/experiments/minimal-feed/minimal-feed-release.sh`, owned by root and mode `0700`. It uses the existing `/opt/memoly/app/deploy/selectel/in-place-file.sh` helper and the same `/opt/memoly/.selectel-deploy.lock` as ordinary Selectel releases.

```bash
sudo /opt/memoly/experiments/minimal-feed/minimal-feed-release.sh status
sudo /opt/memoly/experiments/minimal-feed/minimal-feed-release.sh activate <40-character-git-sha>
sudo /opt/memoly/experiments/minimal-feed/minimal-feed-release.sh off
```

`activate` runs a dedicated read-only Caddy container from the current static image ID, then inserts one marked route into the existing gateway Caddyfile. The helper preserves all other Caddyfile bytes, validates the candidate in the running gateway, saves the live file in a root-only timestamped backup directory, updates it in place, verifies the host and mounted hashes, and reloads Caddy. It checks the experiment HTML and both assets against staged hashes, confirms `no-store`, and verifies the normal root HTML, `/health/live`, `/health/ready`, and existing Compose service image IDs. A failed activation or smoke check restores and reloads the immediate Caddyfile backup under the held lock. `off` removes only the marked route and runs the normal root and health checks.

Old release directories and experiment containers are retained for quick reactivation. This switch does not prune images or containers, replace root UI, change normal service images, alter data, or modify the tracked gateway template. Do not run while either B2 or MM0 forward-only marker exists.

The owner authorized this separate deployment on 2026-10-13. The experiment artifact source is `40ff11a64a4d2827a269e3a71df4c7966d33b549`; the normal production app remains at `920f223fae0216be6a92b6c3ad2199c87bad0c0a`. The earlier delivery proposal in `MEMOLY-PWA-MINIMAL-UI-EXPERIMENT.md` describes the pre-deployment state; this runbook governs the authorized additive delivery.

Rollback to the normal interface uses `off`; reactivation uses `activate 40ff11a64a4d2827a269e3a71df4c7966d33b549`. Future experiment versions must each have their own verified artifact directory and full SHA. Switching among these saved frontend versions requires neither a rebuild nor a database restore. This does not promise compatibility for arbitrary historical backend versions or versions whose artifacts have not been retained; those still use the guarded product release procedure.

For the physical test, open the explicit HTTPS diagnostic URL in Safari. If needed, follow its canonical MAX sign-in link, finish authentication, then return to the diagnostic URL in the same browser profile. Select the actual family and scroll normally beyond the first page. Safari and an installed standalone PWA can have different sessions; a Safari result is not acceptance in standalone mode. The normal UI has no new experiment navigation control. The cause of the white screen remains unconfirmed until the owner performs the physical comparison.

## Delivery receipt — 2026-10-13

- Task: `MEMOLY-PWA-MINIMAL-UI-EXPERIMENT`; branch `experiment/pwa-minimal-feed`; allowed worktree `.worktrees/pwa-crash-diagnostics`.
- Activated artifact source: `40ff11a64a4d2827a269e3a71df4c7966d33b549`. Delivery helper source: `49ac01708b291b38e977991afd1ae9138220e585`. No main publication, PR, or merge.
- Server helper SHA-256 matches the reviewed local file: `07a65f8904ceab67677e173ecc64058183c615a8fb87095102cbb883f6db0694`. Its immutable copy is `/opt/memoly/experiments/minimal-feed/helper-49ac017.sh`.
- Activation, `off`, and reactivation all exited 0. While off, the diagnostic path returned the normal root HTML hash. Final state: source `40ff11a64a4d2827a269e3a71df4c7966d33b549` active. Immediate gateway backups are retained under `/opt/memoly/backups/minimal-feed-*`.
- Public HTML and both assets matched their staged SHA-256 hashes; the response uses `Cache-Control: no-store`. Local artifact verification passed: exactly three files, one isolated CSS asset, no published manifest or worker.
- Root HTML, existing private-media SW, runtime-witness worker, all five normal Compose container IDs and images remained identical before/after. Both health endpoints passed. Production checkout stayed clean at `920f223fae0216be6a92b6c3ad2199c87bad0c0a`. No migrations, data edits, backend changes, or normal service restarts.
- Public Chromium smoke passed (exit 0): HTTPS 200, signed-out canonical MAX handoff visible, exactly one diagnostic stylesheet, no page errors. No private production session was used. Existing local real-backend feed/photo/pagination smoke evidence is recorded in the experiment document; physical iPhone acceptance remains outstanding.
- One fresh independent review found two P2 issues in the helper; both fixed in one bounded pass. Lead closure: Bash syntax passed; valid checksum manifest accepted, duplicate and omitted manifests rejected; post-activation snapshot failure explicitly invokes rollback. No unresolved P0/P1/P2 findings. Scout, worker and reviewer: GPT-6 Luna High; lead: Codex.
- Ignored local evidence: `.scratch/minimal-feed/production-{activate,off,off-proof,reactivate}.log`, `production-{before,after}.txt`, `deploy-closure.log`, `public-smoke.log`, and `public-signed-out.png`.

Artifact SHA-256:

| File | SHA-256 |
| --- | --- |
| `diagnostic.html` | `27f08308c0995f8309852127504bbf5f0e53925ca39bf9eb7613a3beb35cee7e` |
| `assets/diagnostic-feed-Enk8_a8l.css` | `c7d6d743ac85f76ffd1c006c7b8c37aa75ac21fdbdd48e90e5c31aee453d464f` |
| `assets/index-D5KFgtP1.js` | `d95a588a3134653eb813c58c6cb85dff88b05585fca5416f99d90c333375e2e7` |
