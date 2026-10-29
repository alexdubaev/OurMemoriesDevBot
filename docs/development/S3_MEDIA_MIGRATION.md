# Selectel private media migration

Existing protected credential locations are listed in [S3 operations access](S3_OPERATIONS_ACCESS.md).

Scope: preserve every stored original, display/preview/poster/playback variant,
avatar and durable retirement barrier. Keep PostgreSQL, object keys, ACLs, MAX
delivery and the accepted UI unchanged. No SQL migration is needed.

Use FULL because this changes private media and recovery. Run the real provider
retirement and migration roundtrip tests, the PostgreSQL current → d299 → current
deletion recovery matrix, and one independent scoped review before release.
Never put credentials, signed URLs or private content in evidence.

## Provider prerequisites

Use a dedicated private bucket with versioning **never enabled** (empty S3
GetBucketVersioning Status), no Object Lock or automatic expiry, and enforced
conditional PUT and DELETE. Suspended versioning is insufficient. Check these
with synthetic data before copying any user media. For Selectel use virtual-host
addressing and CORS restricted to `https://app.memoly.ru`: GET/HEAD/PUT,
Content-Type/If-None-Match/Range, expose ETag/Content-Range/Accept-Ranges.

Selectel testing found that a zero-byte overwrite can retain the previous bytes
while changing ETag and metadata. Retirement therefore writes **32 random
technical bytes**, records their SHA-256 and reads the exact bytes back before
completion. Repeated retirement verifies the marker. Conditional ordinary delete
uses its observed ETag and cannot remove a concurrent marker. Do not remove
retirement markers, enable bucket versioning, add public access, or revert to an
older S3 driver. Direct signed GETs of retired keys may return technical marker
bytes; app reads treat them as missing.

## Cutover

1. Finish the normal accepted-SHA release while storage remains filesystem.
   Preserve the exact d299 images, the existing filesystem-only rollback guards,
   backups, UI v4, clean source and release receipts. Check actual production SHA,
   accumulated diff, parallel releases and disk space.
2. Take the nonblocking `/opt/memoly/.selectel-deploy.lock` for the entire storage
   operation. A busy lock means wait for its owner, never stop another release.
   Back up the protected runtime env. Load S3 credentials from a root-owned 0600
   file, separately from application secrets; never print their values.
3. Stop backend, worker and scheduler; verify they have stopped and no other
   running container mounts the storage root or an ancestor as writable. Keep
   PostgreSQL and the gateway running. Inventory must reject symlinks, special
   files, unpaired metadata and unexpected remote objects. Check DB references
   against source inventory. Do not copy concurrently with application writers.
4. With the immutable accepted backend image, mount source read-only and an
   isolated scratch directory read/write; pass the five S3 settings as an env
   file, `PRIVATE_STORAGE_FORCE_PATH_STYLE=false` and
   `STORAGE_MIGRATION_WRITERS_STOPPED=true`. Run:

   ```sh
   bun scripts/migrate-private-storage.ts copy /source /migration/copied.json
   bun scripts/migrate-private-storage.ts restore /migration/restored /migration/restored.json
   bun scripts/migrate-private-storage.ts verify /source /migration/copied.json
   ```

   The source inventory, S3 GET SHA-256, restored inventory and byte totals must
   agree, including retirement barriers. Preserve manifests privately. Existing
   remote keys are accepted only when their bytes/type/length match; unexpected
   keys stop the operation rather than resurrecting deleted data.
5. Set driver=s3, the five S3 settings, remote-endpoint allowance=true and
   force-path-style=false through the protected runtime env. Keep other settings
   unchanged. Recreate only the same immutable backend/worker/scheduler services.
   Check effective storage in all three, internal/public live/ready, media reads,
   unsigned access denial and browser preflight. Do not create family data for
   production smoke. If cutover fails, stop writers and restore filesystem
   configuration and the verified files before resuming.
6. After successful smoke and a verified restoration, remove only the enumerated
   old filesystem objects whose hashes still equal the frozen manifest, their
   paired metadata, and this task's scratch restore. Recheck paths/ownership and
   inventory before removal; never use a broad Docker/volume/system prune. Keep
   small manifests and durable retirement barriers. Measure actual `df` change.

## Recovery and later application releases

### Ordinary releases with the accepted S3 recovery baseline

The independently pinned S3 application recovery pair is
`26cfab9ce35fd1a42279fc0d9dd3637c340eec6a`. Its exact backend/webapp IDs,
runtime fingerprint and executable compatibility attestations are enforced by
`redeploy.sh`; the older d299 profile remains filesystem-only.

For an ordinary compatible application update, keep the current protected S3
configuration. Use the normal versioned `ci-release.sh` full entry point, with
migration `false` when the exact catalog is already complete. The entry point
verifies and records the running S3 pair before replacing `rollback.env`.
Readiness checks the target images/labels, lineage, source and host inputs,
installed Control protections, exact completed SQL ledger, unversioned bucket
and a read-only stored-object HEAD/range GET. Unknown runtime/schema changes
still require their own measured compatibility attestation.

Media stays in S3 during both promotion and application rollback. Existing
signed uploads continue using the same keys and endpoint; retirement markers
continue rejecting late uploads. No filesystem inventory, restore, storage
driver switch or upload-URL expiry wait belongs to this ordinary release path.
PostgreSQL stays current; the rollback does not execute legacy-video recovery
SQL or restore a database. The normal release lock, disk floor, DB backup,
immutable artifact, gateway, smoke and configuration guards remain mandatory.

Validate the exact candidate and frozen baseline with the real PostgreSQL/S3
test before accepting a new S3 compatibility profile:

```sh
bun test --timeout 300000 tests/selectel-s3-application-recovery.live.test.ts
```

Provide matching loopback `DATABASE_URL`/`TEST_DATABASE_URL` pointing to an isolated
`*_test` database, and explicit `TEST_S3_RECOVERY_ENDPOINT`, `_REGION`, `_BUCKET`,
`_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_FORCE_PATH_STYLE`. Load credentials only
from the protected operations file. The test creates its own PostgreSQL database
and one random `recovery-checks/<UUID>/` technical object prefix, then verifies
media/caption bytes, foreign/revoked family access, an upload issued before
rollback, durable retirement, partial purge continuation and the unchanged
ledger through current → baseline → current. It also executes the actual deploy
readiness program in both sources. Cleanup deletes only that technical prefix;
no production family rows are created or edited. The test is explicit and fails
without its required dependencies; a skipped live suite is not recovery proof.

An S3 application rollback handles a bad application release. S3 availability
and independent data-backup retention remain separate operational requirements.

### Historical filesystem-only recovery

The existing pinned d299 **application rollback is filesystem-only**. It must
continue rejecting an S3 runtime. Never bypass this guard or run d299 against S3.
If deliberately using this historical target, application rollback first uses
this storage restore. Ordinary releases with the accepted S3 pair above omit it:

1. Hold the same release lock, stop every writer, back up the current env and
   wait for all issued direct S3 upload tickets to expire (configured maximum
   upload URL TTL plus clock margin). This prevents late uploads changing the
   final snapshot. Do not publish an old filesystem snapshot.
2. Restore **current S3 contents** into a new exclusive empty filesystem root
   with the same CLI `restore` operation. It reads every object and restores
   durable filesystem barriers for S3 markers, then verifies every SHA-256 and
   the complete key inventory against S3. Check active DB references as well.
   A failure leaves the current S3 runtime and source untouched.
3. While writers remain stopped, publish that fully verified directory at the
   configured filesystem mount, give it the runtime UID/GID, set driver=filesystem
   and remove the five S3 settings. Recreate the accepted current application on
   filesystem and run smoke and the unchanged `rollback-readiness` verifier.
   Only then may the standard guarded application rollback/release proceed.
4. PostgreSQL is never rolled back. Preserve the independent Control purge queue
   and all retirement fences. S3 markers remain in the bucket, so expired old
   signed uploads cannot resurrect deleted keys. A later filesystem→S3 operation
   must again reconcile the entire inventory under stopped writers.

An S3 outage may delay restoration; do not promise immediate offline recovery
from a storage service that cannot be read. Verify backup retention separately
from primary storage migration. Never claim a restore was tested from HEAD-only
metadata, ETag, a successful upload, or mock call counts.
