# VPS Docker storage and release retention

Keep current runtime images, the exact designated `rollback.env` pair, and every
image referenced by an existing container on the VPS. Backend/API, worker and
scheduler share one image. Never remove a volume, database, gateway, another
task's container, retirement marker, or an image merely because Docker calls it
reclaimable. Historical recovery targets can be archived only after their exact
image IDs and a tested restoration are recorded; the designated pair stays local.

## Release default

Build off-host with the existing `deploy/selectel/build-images.sh` from the exact
accepted clean main SHA. Transfer the two immutable images and use the existing
paired `SELECTEL_PREBUILT_BACKEND_ID` / `SELECTEL_PREBUILT_WEBAPP_ID` path in
`ci-release.sh`. Preserve all source, owner, lock, disk, image-label, migration,
recovery and smoke checks. No GitHub Actions, new registry or app deployment is
needed to install these maintenance tools. Host building remains a recovery
fallback; do not silently leave new build cache/history unbounded afterwards.

Production media currently uses S3. The separate storage restore prerequisite in
[S3_MEDIA_MIGRATION.md](S3_MEDIA_MIGRATION.md) still applies to any application
rollback/release that relies on the filesystem-only d299 recovery attestation.
This maintenance operation neither changes that guard nor promotes application
images, updates PostgreSQL, or switches storage drivers.

## Archive before removing historical images

Use the dedicated private `memoly-release-archives` bucket, not the media bucket.
The media inventory/restore contract deliberately covers its entire bucket.
The archive identity needs only GetObject, PutObject and ListBucket on this
archive bucket. Keep credentials in the existing protected server configuration;
never put secrets, container inspect payloads, container writable layers,
runtime env files, volumes or family media into a Docker image archive.

1. Hold the nonblocking `/opt/memoly/.selectel-deploy.lock`. Inventory exact image
   tags/IDs/OCI revisions, all running **and stopped** container references,
   current service tags and the designated recovery pair. Preserve active tasks.
2. Select only unreferenced historical memoLy images. Save their tags and exact
   IDs in a private manifest. Reject unknown/moved tags and check that archive
   layers contain no application `.env`, private storage, or server secret paths.
3. `docker save` only the explicit selected tags, gzip to a private staging file,
   and record its SHA-256. Keep at least the normal 4 GiB disk floor throughout.
4. Run `image-archive.mjs upload` using the existing SDK in the accepted backend
   image, a protected env file, and `RELEASE_ARCHIVE_BUCKET=memoly-release-archives`.
   Mount the script at `/app/backend/image-archive.mjs` and invoke Bun with that
   filename (not `-e`). Use root only in this disposable maintenance container
   to read the root-only staging directory; never change the app service user.
   Keys are content-addressed; conditional PUT never replaces a different backup.
   The command verifies every uploaded byte and anonymous access denial.
5. Run `image-archive.mjs restore NEW_FILE TRUSTED_SHA256`. Trust the SHA recorded
   locally before upload, not a new value supplied only by the remote object.
   Validate gzip/tar and use `docker load`; check **every** restored image ID.
   Demonstrate a missing disposable image can actually be restored before
   deleting historical tags. Never overwrite an unrelated existing image tag.
6. Recheck live references and exact tag IDs immediately before non-forced
   `docker image rm` of each selected tag. Preserve all images if any archive or
   restoration check fails. Remove only this task's temporary archive files after
   verified remote persistence. Record actual `df` change and public readiness.

Archives preserve historical artifacts; they are not permission to promote
pre-v4 UI or bypass exact-source rollback compatibility. Recovered image IDs and
OCI labels must still pass the existing release checks.

## Bounded native build cache

`storage-daemon-config.py` prepares a separate config candidate, preserving all
unrelated daemon options and refusing custom GC policies or unsafe paths. It
enables native builder GC with a 2 GB target and live restore. The GC target
applies to eligible cache; referenced runtime layers can exceed it.

`docker-storage-maintenance.sh plan` is read-only. Applying the accepted source
requires root maintenance access, the host release lock, valid Docker config,
ordinary standalone Docker systemd stop semantics, a healthy application and
source-bound helper files. It validates the candidate with `dockerd --validate`,
reloads to enable live restore and verifies it **before** one same-version daemon
restart. Container IDs, PIDs, start times, image IDs and restart counters must
remain identical; recovery image IDs and public readiness are checked afterwards.
No `docker stop`, application promotion, network/storage option change or broad
`system prune` is performed. Keep the private old config and state snapshots.

Test the candidate generator on real files, validate it with Docker, and prove
live restore on an isolated local daemon before applying to production. This is
a protected infrastructure change: FULL and one independent scoped review apply.
The explicit root-only integration command is
`bash tests/selectel-storage-live-restore.sh`; it uses its own socket, data root,
exec root and containerd, and leaves diagnostic files in its private temp folder.

Official references: [Docker build GC](https://docs.docker.com/build/cache/garbage-collection/)
and [live restore](https://docs.docker.com/engine/daemon/live-restore/).
