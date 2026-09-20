# MAX Direct Video Upload — Design

## Purpose

Allow an internal memoLy OWNER or FULL family member to choose an existing video
file in the MAX Mini App, upload it directly to MAX, and publish exactly one
video Memory. MAX is the MVP storage/delivery adapter; this does not make a MAX
identity part of the memoLy Memory contract.

## Fixed decisions

- `USE_DIRECT_BROWSER_TO_MAX`: the backend obtains the upload capability with
  its bot credential; the browser performs multipart upload with XHR/FormData,
  progress and abort support, and never receives an Authorization header.
- Accept `.mp4`, `.mov`, `.mkv`, and `.webm` up to 250 MB. Do not create S3
  originals, transcoding, archive/export, MediaRecorder, a second player, or a
  new Add Sheet flow.
- Existing `MaxSource` stays inbound-only (`MaxInbox` remains required). The
  new sender-side durable state is separate from it.
- Existing authenticated `/media/max-videos/:referenceId/content` playback,
  Range behavior, token re-resolution, and current `<video>` UI remain intact.

## Durable model and recovery

Add a family-scoped `MaxVideoUploadSession` with internal author, child, body,
occurredAt, idempotency fingerprint/key, the MAX delivery target in the adapter
layer, state (`reserved`, `uploaded`, `processing`, `message_sent`,
`finalized`, `failed`, `expired`), provider upload/message identities, retry
metadata, and expiry. Its fixed planned Memory ID is the at-most-one-memoLy
boundary. A separate outbound MAX source/message record supplies the current
message/attachment identity required by `MaxVideoReference`, without loosening
inbound `MaxSource` constraints.

Reserve persists the session before creating the MAX upload capability. Finalize
locks/claims the session and repeats family/role/child/ownership checks. It
polls only boundedly for `attachment.not.ready`, sends bot-to-target video only
once when a durable send intent permits it, persists the returned provider
message identity, then calls `createSourceMemoryPublisher.publish` with the
fixed Memory ID and creates the compatible video reference in its after-write
transaction. A duplicate request returns the existing session outcome. If a
provider send succeeds but the database write is lost, recovery first looks up
the durable send identity before any second send; the residual risk is a MAX
provider orphan if MAX offers no idempotency key.

## API and UI

`POST reserve` and `POST finalize` are authenticated, family-scoped production
routes. Reserve returns only a short-lived, non-persistent upload capability;
finalize returns the published Memory DTO or a retryable state. The reusable
Video Composer owns the selected File only in memory, caption/date across
retry, XHR progress, cancel, retry, and single-save protection. A MAX-only
`startapp=max-video-upload-acceptance` route opens this production composer;
ordinary launches do not expose it. On success invalidate/refetch existing feed
queries.

## Security and tests

Both endpoints require current OWNER/FULL access and re-check it at finalize;
wrong family/child, viewer, outsider, and revoked users fail. Browser transport
does not persist URL/token and sends no Authorization header. Tests cover
idempotency, concurrent/double finalize, send and pending failures, recovery,
family isolation/revoke race, file validation, cancellation/retry, feed refresh,
and existing playback regression.
