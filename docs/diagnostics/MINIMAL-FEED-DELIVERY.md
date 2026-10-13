# Minimal feed experiment delivery

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
