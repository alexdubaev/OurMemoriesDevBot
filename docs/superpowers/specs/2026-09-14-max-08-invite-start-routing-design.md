# MAX-08 Invite and Start Routing Design

**Status:** Lead-approved implementation brief

**Date:** 2026-09-14

**Branch:** `feat/max-adapter`

**Design base:** `ea38614e37f7143787c117ed7698e4ec540411a7`

## Goal

Generate provider-correct invite links, consume the signed MAX Mini App `start_param` through the existing authenticated preview/explicit-accept flow, and route MAX `bot_started` invite payloads without creating a provider-specific invite model or auto-accepting membership.

## Scope and invariants

- `FamilyInvite`, its hash-only opaque token, expiry, revocation, single-use acceptance, and family conflict rules remain authoritative.
- MAX and Telegram use the same invite Core. No `MaxInvite`, account linking, provider identity inference, media, group, or channel behavior is added.
- MAX-06 remains `WAITING_FOR_LIVE_PROBE`; MAX-07 remains `WAITING` under the existing video decision.
- MAX remains optional. No live MAX calls, subscription changes, webhook registration, deployment, push, or PR belong to MAX-08.
- Telegram invite links and Telegram invite processing remain behaviorally unchanged.

## Official MAX link contract

The public MAX Mini App link is:

```text
https://max.ru/<bot-username>?startapp=invite_<opaque-token>
```

The payload uses only ASCII letters, digits, `_`, and `-`, and is at most 512 characters. memoLy-generated invite tokens are base64url. MAX accepts a raw invite token only when it is 32–128 characters, so `invite_` plus the token remains within the platform limit and the existing Core request limit. No family, user, or child identifier is placed in the URL.

The MAX bot username is non-secret build-time configuration. It is validated as 5–32 ASCII letters, digits, or underscores before link generation. Missing or invalid configuration fails invite-link creation safely; it never falls back to Telegram while running inside MAX.

## HostBridge and invite UX

`HostBridge` becomes the provider-aware invite-link boundary:

- MAX generates the `max.ru` `startapp` link;
- Telegram generates the existing `t.me/OurMemoriesDevBot?startapp=...` link;
- browser-dev cannot generate a production invite link.

`FamilyScreen` receives a narrow link factory rather than importing a Telegram-only serializer. It continues to show, copy, and share one URL. Running inside MAX therefore produces the MAX link first; running inside Telegram preserves the existing link.

On entry, `createMaxHostBridge()` reads the raw signed `window.WebApp.initData`. If exactly one signed `start_param` is present, its result is authoritative: invalid signed data blocks query fallback. Query `startapp` is used only when the signed field is absent. Authentication still sends the entire raw initData unchanged to `/api/v1/auth/max`; `initDataUnsafe` is never trusted.

After authenticated MAX login, the existing application flow calls `/api/v1/invites/preview` and requires an explicit user action before `/api/v1/invites/accept`. Existing invalid, expired, revoked, used, already-in-family, and other-family behavior remains in the Core and UI.

## `bot_started` routing

MAX acceptance continues to encrypt the normalized `bot_started` event, create one `max:process` task, and return only after commit. To avoid a race between a generic welcome delivery and invite routing, acceptance no longer creates an immediate `welcome` response for `bot_started`; the processor creates the one logical `welcome` response after classifying the payload.

The processor handles:

- no payload or an unrelated payload: ordinary welcome;
- syntactically valid `invite_<opaque-token>` whose Core invite is active, unused, unrevoked, and unexpired: invitation-specific guidance to open the Mini App;
- syntactically valid invite payload whose Core invite is missing, inactive, used, revoked, or expired: the existing safe invalid/expired wording;
- malformed `invite_` payload: ordinary welcome without querying by partial token.

The families module owns a narrow read-only invite-start resolver. MAX calls that public boundary rather than reading `familyInvite` directly. The resolver exposes no family/member data and never accepts the invite.

The raw token remains only in the encrypted inbox payload while processing is pending. It is not copied into logs, task payloads, `MaxOutgoingResponse`, public errors, or another durable table. Terminal processing clears the encrypted payload under the existing guarded transition. `MaxOutgoingResponse` continues using the existing `welcome` kind, so no schema migration is required.

## Retry and failure behavior

- `MaxInbox.eventKey` remains the permanent incoming dedupe authority.
- `TaskOutbox` continues to contain only `{ inboxId }` and `{ responseId }` references.
- A transient database failure while resolving or completing `bot_started` leaves the encrypted payload and task retryable.
- Terminal transition and logical response creation remain one transaction.
- A duplicate processor cannot create a second logical response.
- Response delivery remains independent and at-least-once under MAX-05 semantics.
- No `User`, `ExternalIdentity`, `FamilyMember`, or invite acceptance is created from `bot_started`.

## Planned code surface

Expected production paths:

- `webapp/src/platform/host-bridge.ts`
- `webapp/src/platform/max/host-bridge.ts`
- `webapp/src/platform/telegram/host-bridge.ts`
- `webapp/src/features/family/FamilyScreen.tsx`
- `webapp/src/App.tsx`
- `webapp/src/main.tsx`
- `webapp/.env.example`
- `backend/src/modules/families/application/invite-start.ts`
- `backend/src/modules/families/index.ts`
- `backend/src/modules/max/application/accept-update.ts`
- `backend/src/modules/max/infrastructure/process-task.ts`

Tests may change only in the corresponding webapp, families, MAX, and Telegram regression suites. No Prisma schema/migration, Telegram production processor, media module, lockfile, deployment, or generated file is allowed.

## Acceptance evidence

Tests must prove:

- MAX and Telegram generate the correct provider-specific links from the same opaque token;
- MAX username, payload charset, and length fail closed;
- signed MAX `start_param` precedence and invalid-signed-value fallback blocking;
- authenticated MAX start parameter reaches existing preview and explicit accept behavior;
- `bot_started` valid/invalid/expired/revoked/used/no-payload routing;
- `bot_started` never accepts an invite or creates identity/family data;
- duplicate/concurrent processing creates one logical response and clears payload only after terminal commit;
- delivery failure does not rerun invite routing;
- existing Telegram invite behavior remains green;
- backend/webapp/contracts typechecks and architecture checks pass.

## STOP conditions

- Any design requires trusting `initDataUnsafe`, storing the raw invite token outside the temporary encrypted inbox, auto-accepting membership, or adding a provider-specific invite model.
- MAX bot username cannot be supplied as validated non-secret build configuration.
- A Prisma migration, Telegram production behavior change, live MAX call, media work, or account-linking behavior becomes necessary.
- Existing Core cannot preserve invalid/expired/revoked/used semantics through a narrow families-owned boundary.
