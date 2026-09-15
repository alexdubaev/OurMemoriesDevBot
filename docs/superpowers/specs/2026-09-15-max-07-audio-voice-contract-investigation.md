# MAX-07 AUDIO/VOICE — bounded contract investigation

**Status:** BLOCKED — live representation not established

**Date:** 2026-09-15

**Video prerequisite:** APPROVED at `c225dc588f8a1a8034f5fb807e94ecc90334f798`

## Scope

This investigation is separate from the approved MAX-hosted video design. It does not authorize
audio/voice implementation, a migration, a webhook/subscription change, or reuse of video token,
resolver, retention, and CDN semantics.

## OFFICIALLY DOCUMENTED

- MAX `POST /uploads` accepts `type=audio`; the documentation names MP3, WAV, M4A, and other audio
  formats, with a 256 MB and 60 minute limit. The documented upload host family is
  `https://omu.okcdn.ru`.
- MAX `POST /messages` accepts an `audio` attachment created from an upload token.
- MAX documents `GET /messages` for retrieving messages.
- The current official method catalogue documents a dedicated resolver for video,
  `GET /videos/{videoToken}`. The investigation found no corresponding documented audio/voice
  retrieval resolver or inbound audio payload schema.

Sources checked:

- https://dev.max.ru/docs-api/methods/POST/uploads
- https://dev.max.ru/docs-api/methods/POST/messages
- https://dev.max.ru/docs-api/methods/GET/messages
- https://dev.max.ru/docs-api/methods/GET/videos/-videoToken-

## OBSERVED IN THE REPOSITORY

- MAX normalization and provider ports currently model `image`, `file`, and `video`, not native
  `audio` or `voice`.
- Unknown MAX attachment types remain unsupported; an ambiguous `type=file` is accepted only when
  its bytes validate as an image.
- memoLy's existing provider-independent voice path stores the original in private storage,
  prepares an AAC/M4A playback rendition, measures 48 waveform peaks, and serves it through the
  authenticated private-media boundary.
- The approved MAX video path deliberately stores only a provider reference. That policy cannot be
  applied to audio/voice without separate evidence and an owner decision because the product voice
  contract retains the original.

## UNKNOWN

- Whether a native MAX voice recording arrives as `audio`, `voice`, `file`, or another type.
- The inbound payload fields, stable attachment identity, MIME, duration unit, size, and whether a
  token or URL rotates across repeated message reads.
- Whether an official long-term audio resolver exists, and its authorization, URL host, redirect,
  retention, and deletion rules.
- Whether native voice and uploaded audio/file have the same representation.

## Required live evidence

After the SSH host key is independently re-verified by the owner, establish a fresh read-only
baseline and ask the owner to send two separate synthetic direct messages to the existing MAX bot:

1. one short native voice recording;
2. one short synthetic audio file through the normal MAX attachment UI, if that UI exposes it.

For each new exact message `mid`, inspect the redacted inbound shape and repeat
`GET /messages?message_ids=<URL-encoded-mid>`. Record attachment count, position, type, stable ID,
MIME, duration, size, and presence/rotation of transient token/URL. Do not fetch media bytes or call
an undocumented resolver during this contract-only probe.

## Current blocker

The owner-approved staging ED25519 fingerprint is
`SHA256:zILDJSwxr8AxhBdQHRDk/aD5YCEChk2eW1NNmgFULZI`. On 2026-09-15 both the existing `known_hosts`
entry and a fresh `ssh-keyscan -t ed25519 136.234.5.56` produced
`SHA256:zILDJSWxr8AxhBdQHRDk/aD5YCEChk2eWINNmgFULZI`. The comparison was case-sensitive and did not
match. Per the owner's explicit SSH rule, no SSH connection, secret-source inspection, or MAX API
call was made.

The owner must independently verify the currently presented fingerprint through the Selectel
console and explicitly approve it before the live baseline can continue. Do not replace or bypass
strict host-key checking.

## Architecture decision after evidence

Prefer the existing private voice `MediaAsset` pipeline only if a documented/observed MAX contract
provides safely retrievable audio bytes and the original-storage requirement can be met. A
provider-owned reference is eligible only if its resolver and lifecycle are established and the
owner explicitly accepts the different retention policy. Otherwise keep MAX audio/voice
unsupported.

