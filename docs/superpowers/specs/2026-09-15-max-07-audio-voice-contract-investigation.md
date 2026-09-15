# MAX-07 AUDIO/VOICE — bounded contract investigation

**Status:** OWNER APPROVED LIMITATION — native MAX voice unsupported in MVP

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

## Live native-voice probe result

The owner independently corrected and approved the authoritative staging ED25519 fingerprint as
`SHA256:zILDJSWxr8AxhBdQHRDk/aD5YCEChk2eWINNmgFULZI`. A fresh scan matched it exactly. The protected
secret source was a non-empty regular `root:root` file with mode `600`; its value was not printed.
`GET /me` and `GET /subscriptions` returned 200, the expected bot identity was confirmed, and there
were zero active subscriptions. No subscription or webhook was changed.

The fresh `GET /updates` baseline marker was `10503`. After the owner sent one synthetic native voice
recording, reading from that marker returned exactly one new event and next marker `10505`:

- `update_type = message_created`;
- event keys were exactly `timestamp`, `update_type`, and `user_locale`;
- the event contained no `message`, `body`, `mid`, or attachments.

The same marker was read repeatedly, both with and without a `types=message_created` filter, and
returned the same incomplete shape. Because no `mid` was delivered, an exact `GET /messages`
lookup could not be formed. Consequently the probe cannot establish attachment type, stable
attachment identity, token/URL behavior, MIME, codec/container, duration, repeated message lookup,
late retrieval/redelivery, or a resolver contract.

## Verdict

The observed native voice contract is not sufficient for a reliable memoLy MVP integration. There
is no stable reference or safe retrieval boundary to implement from this event, and inferring
generic audio or video semantics would be guesswork. Native MAX voice should remain unsupported
unless MAX documents/fixes the event or provides a supported way to recover its message identity.

An ordinary MP3/M4A attachment probe is optional follow-up for a distinct `audio` feature. It is not
a blocker for this native-voice verdict and no conclusion about ordinary attached audio is made.

## Architecture decision after evidence

The owner confirmed that native MAX voice remains unsupported for this MVP. Do not invent or
reverse-engineer a retrieval path, fabricate identifiers, add provider-specific hacks, or create an
unbounded retry path for the identity-less event. Where an event can be durably identified and
safely normalized, the existing generic unsupported-media semantics remain appropriate. This live
event cannot be durably identified, so fail-safe behavior and this documented limitation are the
accepted outcome.

Ordinary attached MP3/M4A remains undecided and is an optional future probe, not a blocker for
MAX-07. No conclusion about ordinary audio-file support is derived from native voice. Telegram
voice remains supported and unchanged.
