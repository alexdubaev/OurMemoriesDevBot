# MAX direct video upload — operator acceptance checklist

This checklist is for a non-production MAX WebView acceptance run. Use only a
synthetic video generated for the run. Do not use family photos, family video,
personal captions, production accounts, a real bot credential, or a copied
provider capability URL/token.

## NO-DEPLOY gate

- [ ] Confirm this run is local, test, or staging only; production is out of
  scope.
- [ ] Confirm no deploy, migration against a shared/production database,
  webhook change, bot configuration change, or credential use is part of this
  checklist.
- [ ] Stop immediately if the requested acceptance step would deploy or require
  a production credential. Record `Deployment performed: NO` in the acceptance
  record and obtain a separate owner-approved release task before any deploy.

## Scope and safe evidence

- [ ] Record the build commit, environment name, date, and operator only.
- [ ] Confirm the environment uses the test MAX bot and synthetic family data.
- [ ] Keep upload capabilities and upload tokens in the browser/app process
  only. Never paste them into tickets, screenshots, shell history, analytics,
  chat, or test output.
- [ ] If logs are needed, retain only session ID, stage, HTTP status, redacted
  provider host/path, file size/type, and timing. Remove query strings,
  capability URLs, tokens, Authorization headers, and response bodies before
  attaching evidence.
- [ ] Delete the synthetic family, Memory, and test artifacts after the run.

## Synthetic fixture

Create or select a short color-card video with no people, voices, names, or
location data. The fixture must be one of the accepted formats and below the
250 MB limit.

| Field | Fixture value |
| --- | --- |
| File | `synthetic.mp4` |
| MIME | `video/mp4` |
| Size | A small positive synthetic size below 250 MB |
| Caption | `Synthetic MAX upload acceptance` |
| Occurred at | A fixed test timestamp at or before the current test time |
| Child | A synthetic child in the test family |

The exact bytes are not important; they must be generated test data and must
decode as a valid video in the target MAX test environment. Never replace this
fixture with a family recording to make the test more realistic.

## MAX WebView flow

- [ ] Open the Mini App with `start_param` or `startapp` set to
  `max-video-upload-acceptance`.
- [ ] Confirm the direct-video composer is available only in this acceptance
  launch. A normal launch must retain the existing UI and must not expose the
  composer.
- [ ] Select `synthetic.mp4`; confirm unsupported extensions, mismatched MIME,
  empty files, and files over 250 MB are rejected locally.
- [ ] Enter the synthetic caption and date, then save once.
- [ ] Confirm reserve succeeds for an OWNER/FULL member and shows upload
  progress. Confirm the browser upload is multipart `data` and has no bot
  `Authorization` header.
- [ ] Confirm the capability URL/token is not written to localStorage,
  sessionStorage, cookies, URL parameters, durable app state, telemetry, or
  third-party requests. Do not copy the values while inspecting DevTools.
- [ ] Confirm finalize succeeds through the authenticated memoLy endpoint and
  the feed contains exactly one new Memory with the fixed session result.
- [ ] Confirm the Memory plays through the existing authenticated HTML5 video
  path and the feed refresh shows the same Memory, not a duplicate.

## Authorization and leak regression

- [ ] With the same synthetic session, try finalize as a different authorized
  family member. The request must be rejected before a provider send and must
  not publish a Memory.
- [ ] Repeat as a VIEWER, revoked member, outsider, wrong family, and wrong
  child. Each attempt must return a sanitized authorization/not-found result;
  none may reveal a session outcome, provider capability, upload token, or
  Memory ID.
- [ ] Treat knowledge of the provider capability alone as insufficient: only
  an authorized server-side finalize may send the MAX message and publish the
  fixed Memory ID.
- [ ] Verify the backend regression named
  `a leaked provider capability cannot publish a Memory for another authorized
  family member` passes without provider-send or publisher calls.

## Retry, cancellation, and expiry

- [ ] Cancel an in-progress synthetic upload. Confirm the request aborts,
  transient file/capability state is cleared, and no Memory is created.
- [ ] Exercise a retryable provider-processing response. Retry with the same
  session/token state and confirm one provider send and one Memory only.
- [ ] Exercise an expired memoLy reservation. Confirm the expired operation is
  not finalized and its old capability is not reused; a new selection/reserve
  operation obtains a new capability.
- [ ] Repeat finalize concurrently. Confirm one durable processing claim, one
  provider message, one outbound source/reference, and one Memory.

## Accepted provider-URL residual risk

MAX controls the capability URL lifetime; it may be unlimited and memoLy cannot
revoke it after disclosure. `expiresAt` expires only the memoLy reservation and
finalize lifecycle. A leaked provider URL may therefore remain usable at MAX,
but possession of that URL/token alone cannot create a memoLy Memory: family,
role, author, child, expiry, and idempotent finalize checks remain server-side.
This is an accepted MVP residual risk, not an expiry guarantee. Handle the URL
and token as sensitive ephemeral values, minimize exposure, and rotate/revoke
them through the provider if MAX later exposes such a control.

## Acceptance record

Use this safe summary; do not attach raw network captures or unredacted logs.

- Build commit: ____________________
- Test environment: ____________________
- Deployment performed (must be `NO`): ____________________
- Synthetic fixture hash (optional): ____________________
- Authorized upload/finalize: pass / fail
- Playback and feed deduplication: pass / fail
- Authorization/leak regression: pass / fail
- Cancellation/retry/expiry: pass / fail
- Provider URL/token redaction confirmed: pass / fail
- Residual-risk owner and follow-up: ____________________
- Notes containing no capability URL/token: ____________________
