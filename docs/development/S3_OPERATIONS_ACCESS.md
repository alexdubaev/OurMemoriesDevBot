# S3 operations access for project agents

This is a discovery note for existing authorized access, not a grant of new
production permissions. Follow AGENTS.md, the task scope and applicable host,
private-media, deletion, recovery and release safeguards.

## Persistent protected configuration

- Local Windows host, same owner account: `D:/codex/secrets/memoly/s3-operations.env`.
  The directory has a private owner-only ACL; the file inherits it.
- Production host `app.memoly.ru`, through existing authorized SSH access:
  `/opt/memoly/secrets/s3-operations.env`, root-owned mode `0600`, in a root-only
  directory mode `0700`.

These files contain the existing service user's S3 endpoint, region, media bucket,
access key ID and secret access key. Field names are `PRIVATE_STORAGE_ENDPOINT`,
`PRIVATE_STORAGE_REGION`, `PRIVATE_STORAGE_BUCKET`,
`PRIVATE_STORAGE_ACCESS_KEY_ID`, `PRIVATE_STORAGE_SECRET_ACCESS_KEY`.
They are operational copies, not the application runtime env; do not substitute
them wholesale for a service's complete configuration.

Load values directly into the intended SDK or disposable maintenance process.
Never print/cat the files, paste their contents into chat, logs, task evidence,
command arguments or a PR, or copy them into a checkout/image/build context.
Do not commit credentials or signed private URLs. Do not broaden ACLs to make
access easier. The original migration/temp copies may still be used by recovery
receipts; preserve them until their references have been audited.

An agent running under this local owner account can use the local protected file.
An agent on the authorized server can use the root-only server copy. A remote or
cloud agent without this filesystem/SSH access does not automatically receive
credentials; never publish them to bridge that gap.

## Bucket destinations

| Bucket | Purpose | Operational boundary |
| --- | --- | --- |
| `memoly-private-media` | Live family media | Use the existing application storage/access contracts. Never store Docker archives or unrelated backups here: media reconciliation and recovery inventory cover this bucket. |
| `memoly-release-archives` | Verified Docker image archives | Existing `memoly-storage-prod` access permits GetObject, PutObject and ListBucket. No archive deletion permission was granted. |

The protected file's `PRIVATE_STORAGE_BUCKET` identifies the media bucket.
For [image-archive.mjs](../../deploy/selectel/image-archive.mjs), explicitly set
`RELEASE_ARCHIVE_BUCKET=memoly-release-archives`; it refuses any other destination.
Use the script as a mounted file in the accepted backend image, as described in
[Docker storage retention](DOCKER_STORAGE_RETENTION.md). Do not send credentials
to a new endpoint or assume this key has access to arbitrary buckets.

Scheduled off-host PostgreSQL backups were not installed by the media migration
or image archival work. The archive bucket is not evidence of an automatic
database/media backup policy. See [media migration and recovery](S3_MEDIA_MIGRATION.md)
for actual storage and rollback requirements.
