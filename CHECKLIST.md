# «Наши воспоминания» — product checklist

This is the completed product record for OurMemoriesDevBot. `docs/mvp/00_START_HERE.md` and `docs/mvp/01_PRODUCT.md` define product scope; this checklist records the same decisions in the Vibe intake format for future agents.

**For agents:** treat decisions below as already made. Do not re-open them during Block 00. A field marked `deferred / not required for Block 00` needs a later explicit product decision, not a template default.

**Install status:** `completed 2026-09-09`
<!-- Set to: not started | in progress | completed YYYY-MM-DD -->

---

## 1. Project identity

| Question                                                        | Answer       |
| --------------------------------------------------------------- | ------------ |
| New project from this template, or work on the template itself? | New product from Vibe: «Наши воспоминания» |
| Project name / slug                                             | OurMemoriesDevBot |
| Your own GitHub repository URL, if you have one                 | https://github.com/alexdubaev/OurMemoriesDevBot.git |

If no GitHub destination is chosen, the repository is left without `origin` and publishing stays unconfigured. The template remote is detached during setup unless this checkout is explicitly for improving the template.

## 2. Product

| Question                                                  | Answer       |
| --------------------------------------------------------- | ------------ |
| What product do you want to build first?                  | Private family memories feed through @OurMemoriesDevBot and Telegram Mini App |
| What is the first user journey that must work end to end? | A full-access family member sends a photo, video, voice, or note and sees it in their private family feed |

## 3. Active surfaces

Mark what is active now, and set the install status to `in progress` as soon as this section is answered. From then on, everything unmarked is deferred and must be left alone: no features, no setup, no test flows. While the status is still `not started` nothing has been decided yet, so unmarked boxes mean "not asked", not "forbidden".

- [x] `backend` - API, PostgreSQL, Telegram adapter boundary
- [x] `webapp` - Telegram Mini App (no public SEO surface)
- [ ] `website` - public pages that must rank in search or preview when shared
- [ ] `mobile` - Expo app (lives on the `mobile` branch; switch branches before setup)

| Question                                                                                                             | Answer       |
| -------------------------------------------------------------------------------------------------------------------- | ------------ |
| Why the unmarked surfaces are deferred, if it needs explaining                                                       | MVP starts with Telegram Bot + Mini App. Public website, native iOS/Android, and VK are deferred and not implemented. |
| If `mobile` is active: are Expo/EAS builds, Expo Push, and Maestro E2E needed now, or left unconfigured until later? | n/a — mobile is deferred / not required for Block 00 |

The split between `webapp` and `website` is the agent's call, not the user's; `README.md` explains how to route a feature between them.

## 4. First-version capabilities

Ask about product needs, not implementations. Mark what the first version actually needs, then fill the row below even when nothing was ticked, so a later session can tell "asked, and the answer was no" from "not asked yet".

- [x] Accounts / sign-in
- [x] Saved data that survives a restart
- [x] File, image, or media uploads → also answer _Files, images, and media_
- [ ] Paid subscriptions or one-off payments → also answer _Payments_
- [x] Admin tools or roles
- [x] External integrations (which: Telegram Bot API)
- [ ] Real-time chat, presence, collaboration, or live updates

| Question                                                                                          | Answer       |
| ------------------------------------------------------------------------------------------------- | ------------ |
| What the first version explicitly should NOT do (write "nothing ruled out" if that is the answer) | AI; Telegram group ingestion; payments; calendar; comments; search; public social features; native iOS/Android; VK. |

## 5. Files, images, and media

Private family media follows the approved limits and retention policy in `docs/mvp/05_STORAGE_SECURITY.md`.

| Question                                                                                      | Answer       |
| --------------------------------------------------------------------------------------------- | ------------ |
| What do users upload?                                                                         | Photos, videos, voice messages, and text notes. A photo album contains 1–10 photos; text bodies are at most 8,000 Unicode code points. |
| Public, private, shared with selected people, or mixed?                                       | Private to one family. There is no public feed, group ingestion, or shared public link. |
| Who can upload, view, replace, and delete?                                                    | Full-access members create, edit, and delete family memories; viewers read, download visible files, and like. The owner manages members and family settings. |
| Maximum file size and allowed file types                                                      | Family originals: 2 GiB. Photos ≤20 MB/40 MP; voice ≤20 MB/600 s; bot-cloud video ≤20 MB; direct Mini App video ≤100 MB/180 s/4K. |
| Do images need thumbnails, resizing, format conversion, compression, cropping, or moderation? | Keep originals unchanged. Later media blocks create display/preview derivatives, remove location metadata from derivatives, and validate decode/MIME; no AI moderation or user crop editor. |
| How long do files live after the owning record is deleted?                                    | Hide immediately; delete live objects within 24 h when infrastructure is healthy. Backups retain for 30 days and deletion tombstones are re-applied on restore. |
| Should filenames be visible to users, or opaque?                                              | Storage keys are opaque and server-generated. User-facing filenames are not a product feature. |

## 6. Website data and freshness

Answer these when `website` is active; otherwise mark the rows `n/a`. Keep product choices here and
follow the implementation contract in `docs/WEB_SURFACES.md`.

| Question                                                                                    | Answer       |
| ------------------------------------------------------------------------------------------- | ------------ |
| Which public product or content data comes from the backend/database at website build time? | n/a — public website is deferred / not required for Block 00 |
| How soon after that data changes must the public website show the change?                   | n/a — public website is deferred / not required for Block 00 |
| Which changes require an automatic rebuild/redeploy rather than a manual release?           | n/a — public website is deferred / not required for Block 00 |

The default is Astro SSG. Database-backed public data is fetched while building static output. If
published database changes must appear automatically, implement the documented `website:rebuild`
outbox path. SSR or request-time rendering is an exception recorded here only when the required
freshness or personalization cannot be met by rebuild/redeploy.

## 7. Payments

Answer these only when payments are active above; otherwise mark the rows `n/a`. Keep the section either way, and replace the `n/a` answers if payments are added later.

| Question                                                                                                                    | Answer       |
| --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| What exactly do users pay for?                                                                                              | n/a — payments are out of MVP scope |
| Recurring subscription, one-off purchase, or both?                                                                          | n/a — payments are out of MVP scope |
| Does the public website need a local cart or offer selection before registration/sign-in?                                   | n/a — payments and public website are out of MVP scope |
| Which active surfaces need payment: browser checkout, App Store / Google Play, native card entry, Apple Pay, or Google Pay? | n/a — payments are out of MVP scope |
| What stops working when someone does not pay?                                                                               | n/a — payments are out of MVP scope |

Whatever this project ends up with, the ledger below is what states it. Read `docs/WEB_SURFACES.md`
before implementing any payment surface. Browser checkout is built in authenticated `webapp` plus
the backend; `website` may pass a local cart but never owns a second payment flow. The `mobile`
template line ships App Store and Google Play subscriptions as working code that is switched off,
and may independently add policy-compliant card, Apple Pay, or Google Pay flows when the product
needs them. Declining a shipped payment capability means deleting its code during setup and
recording it as `removed`. Payments are never half-present and are never reintroduced on a guess.

## 8. Deployment

| Question                                                                                     | Answer       |
| -------------------------------------------------------------------------------------------- | ------------ |
| Is deployment needed now, or local-only for the moment?                                      | Deferred / not required for Block 00 |
| Where are your users, and must the data stay in Russia?                                      | Deferred / not required for Block 00 |
| Hosting, picked by the agent from the answer above: DigitalOcean / Yandex Cloud / own server | Deferred / not required for Block 00 |
| Production domains / URLs for API, webapp, and website; is Yandex CDN needed now?            | Deferred / not required for Block 00 |
| Which surfaces are released first                                                            | Deferred / not required for Block 00 |

**Ask the audience question, not the provider question.** A product owner knows where their users
are and whether data must stay in Russia; they should not be asked to compare clouds. The agent
picks the hosting from that answer:

| Hosting      | Chosen when                                                                        | What the template gives you                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DigitalOcean | Default for an audience outside Russia.                                            | Terraform creates App Platform API/static sites, a scheduler worker, migration gate, Managed PostgreSQL, DOCR, private media Spaces, and remote state. Release everything with `bun run release -- digitalocean`. |
| Yandex Cloud | Users in Russia, or data must stay there.                                          | Terraform creates Serverless Containers/timers, Managed PostgreSQL, API Gateway, static and private media Object Storage, remote state, and opt-in CDN. Release everything with `bun run release -- yandex`.      |
| Own server   | Full control wanted, no vendor lock-in, and someone is willing to run the machine. | The same Docker image plus the in-repo scheduler, with a short runbook in the "Own Server" section of `docs/DEPLOYMENT.md`. No release script: you own TLS, backups, updates, and monitoring.                     |

Pick exactly one and record it above. In an installed project, delete the unused provider directory
under `infra/` and its provider runbook rather than keeping a second possible production state.
Keep `scripts/infra.mjs` and `docs/DEPLOYMENT.md`: they own the shared safety/release contract. An
own-server project deletes both provider directories and runbooks. Local development never requires
cloud credentials regardless of the choice.

Deployment is often deferred at install time, which leaves these rows `_unanswered_`. When the user later asks to deploy, ask the unanswered questions then and write the answers back here before following `docs/DEPLOYMENT.md`.

## 9. Decided by the agent - do not ask the user

The user is a product owner, not an engineer. These are engineering decisions the agent owns, makes, and explains only in product terms:

- Which browser surface a feature belongs to (`website` for SEO/public, `webapp` for behind-login).
- Which email provider the recorded hosting implies: Yandex Cloud means Postbox, anything else means Resend. Ask where the users are, not which mail service the owner prefers.
- SSG plus build-time backend data and rebuild/redeploy for public product information unless a recorded freshness or personalization need requires runtime rendering.
- One browser checkout in authenticated `webapp`; `website` may hand off a local cart but never owns payment. Mobile payment UI stays native and separate.
- Monolithic backend; no microservices during setup.
- Docker Compose for local PostgreSQL on every OS; never a native install unless the user insists.
- Astro for `website`; Next.js only if Vercel-style ISR is a stated product requirement.
- The selected Terraform launch profile, machine sizes, serverless/static shape, and when an HA or CDN upgrade is justified.
- Which hosting the recorded audience implies: Russia means Yandex Cloud, elsewhere means DigitalOcean, and an explicit wish for full control means an own server. Explain the pick in product terms; never ask the owner to compare providers.
- Managed Redis-compatible Pub/Sub only when real-time needs to scale across instances.
- Test boundaries follow the failure mechanism: unit for pure/client rules, contracts for shared wire shapes, backend integration for route/auth/database behavior, and a curated browser portfolio for product-critical client-to-API journeys and real-browser risks.
- Libraries, file layout, naming, refactors, and validation scope.

## 10. Capability ledger

What this project actually contains. The agent updates it whenever a capability is added or removed. Every row carries exactly one state:

- `included` - present and expected to work.
- `available` - partly there but not usable yet; the note says exactly what is still missing, which may be configuration, routes, or UI.
- `absent` - not part of this project. Build it only after the product owner asks.
- `removed` - deliberately deleted during setup. **Do not re-add it.** A leftover reference, migration, or doc mention is not a product requirement; ask the product owner first.

A capability with no row is `absent` by default. Add the row instead of assuming. The State column always holds one of the four states above - never `_unanswered_` or `n/a`.

| Capability                      | State    | Note                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram identity and sessions  | available | Block 01 adapts the retained Vibe session primitives to verified Telegram initData. No fake Telegram login is implemented in Block 00. |
| Family roles                    | available | Block 01 introduces family membership and full/viewer access. The MVP has no global product-admin role. |
| Family memories and likes       | available | Blocks 02 and 07 implement the private feed, four formats, ordering, and likes. |
| Private family media            | available | Block 03 replaces the retained avatar example with family media, quota, access checks, and deletion policy. |
| Telegram bot capture            | available | Block 04 implements @OurMemoriesDevBot ingestion. No polling, webhook, token use, or group ingestion exists in Block 00. |
| Auth (email + password)         | available | Retained Vibe technical foundation only. It is not an MVP user journey and the active webapp does not expose it. Block 01 owns the Telegram replacement boundary. |
| Admin roles                     | available | Retained Vibe code only; it is not the MVP family-role model and not a supported product UI. |
| Password reset email delivery   | available | Retained Vibe code only; it is not a supported MVP user journey and must not be enabled as a substitute for Telegram identity. |
| File/media storage              | available | Retained Vibe storage port and avatar example are technical foundations. Product media follows the Block 03 contract. |
| Infrastructure as code          | included | Provider-specific Terraform bootstrap, foundation, migration/runtime, and static roots cover DigitalOcean and Yandex Cloud, with remote state, guarded plan/apply, migration-gated immutable releases, media storage, static hosting, and jobs. `scripts/infra.mjs` is the one operations entry point. See `infra/README.md` and `docs/DEPLOYMENT.md`.                                                               |
| Static asset precompression     | included | `bun run static:precompress` writes `.br` and `.gz` next to the text assets in `webapp/dist` and `website/dist`, using `node:zlib` and no dependency. It is own-server tooling: hosted releases do not upload those sidecars and use their edge/runtime compression when available.                                                                                                                                  |
| Storybook component catalogs    | included | Separate local React/Vite catalogs cover every `src/components/ui` module in `webapp` and `website`, with official docs/a11y addons and story-only composition examples. They are not deployed; Astro sections remain outside Storybook and the website stays static SSG.                                                                                                                                       |
| Website build-time backend data | absent   | The baseline landing content is repository-owned; add a shared public DTO and build fetch only when `website` needs database-backed information.                                                                                                                                                                                                                                                                     |
| Automatic SSG rebuild           | absent   | Durable desired/published revision state, single-flight deployment reconciliation, immutable atomic/blue-green release promotion, public-marker verification, and a provider adapter are not implemented. Yandex additionally needs a separate builder/upload component. See `docs/WEB_SURFACES.md`.                                                                                                                 |
| Website cart handoff            | absent   | No local cart or cross-origin handoff exists on the default branch. When activated, it feeds the one authenticated browser checkout defined in `docs/WEB_SURFACES.md`.                                                                                                                                                                                                                                               |
| Browser checkout / payments     | absent   | No browser checkout or payment code exists. Build it in `webapp` plus the backend, never in `website`. Store subscriptions come from the mobile template line.                                                                                                                                                                                                                                                       |
| Push notifications              | absent   | No push code here. Expo Push comes from the mobile template line.                                                                                                                                                                                                                                                                                                                                                    |
| Social sign-in (Apple / Google) | absent   | No social auth here. It comes from the mobile template line.                                                                                                                                                                                                                                                                                                                                                         |
| Real-time / WebSockets          | absent   | Requires an explicit product need.                                                                                                                                                                                                                                                                                                                                                                                   |
| Shared rate-limit state         | absent   | The auth and admin limiters count in process memory (`backend/src/http/security.ts`). DigitalOcean runs a single API instance, so the budgets are global there; Yandex Serverless Containers scale out per concurrent request, so on that hosting they are per instance. Moving the counter into the PostgreSQL this repository already runs is the recorded next step if Yandex hosting is chosen. See `docs/DEPLOYMENT.md`. |
| Background jobs                 | included | Jobs live in `backend/src/jobs.ts`. The shared scheduler runs `outbox:drain` every minute, upload cleanup hourly at minute 15, and auth cleanup daily at 03:00 UTC. Terraform deploys that scheduler as a DigitalOcean worker and the same executor in Yandex HTTP job containers/timer triggers; own servers run it under a supervisor. `workerLoops` stays empty. See `docs/BACKGROUND_JOBS.md`.                              |
| Durable task outbox             | included | `task_outbox` in PostgreSQL with handlers in `backend/src/outbox/handlers.ts`, drained by `outbox:drain`. Ships with the password-reset emails as its only producers, and stays empty until something enqueues. Adding a task type is a code change, never a migration.                                                                                                                                              |

## 11. Environment checks

Verified by the agent during setup, not asked.

- [ ] `docker compose version` and `docker info` succeed (needed for backend/API, uploads, or DB-backed validation)
- [ ] `git remote -v` inspected; template remote detached unless contributing to the template
- [ ] App-local `.env` files created from `.env.example`, with a locally generated `JWT_SECRET` (never committed)
- [ ] Smallest meaningful validation run for the active surfaces

## 12. After setup

- [ ] Durable answers above filled in, install status set to `completed YYYY-MM-DD`
- [ ] Validation scope recorded for this project (which suites run before a change is called done): _unanswered_
- [ ] Project renamed from the template identifiers (`web_app_demo`, `web-app-demo`, `vibecoding-template`, the `Vibe Coding Template` page title), `bun.lock` regenerated
- [ ] Deferred-surface notes added to the READMEs of surfaces that are not active
- [ ] `Bootstrap-Only Instructions` block deleted from `AGENTS.md`
- [ ] Local URLs, commands run, and anything the user must authorize manually reported back to the user

`README.md`, `AGENTS.md`, and some `docs/` runbooks route agents into this file by section name, so renaming a heading breaks those pointers silently. Add rows and sections a project needs, and cross-reference sections by name rather than by number so renumbering stays harmless.
