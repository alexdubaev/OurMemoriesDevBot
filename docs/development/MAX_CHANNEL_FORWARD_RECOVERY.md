# Connected MAX channel forward recovery

Incident: a senderless channel forward was denied before importing its nested
content. The fixed path reads the actual message in the connected family channel,
validates its envelope and current family binding, and imports the nested photo,
video, voice or text through existing publication and source deduplication.
It never fetches the original foreign channel or republishes to MAX.

For one owner-confirmed failed source, use the accepted deployed backend image:

```sh
bun scripts/recover-max-channel-forward.ts plan SOURCE_UUID
bun scripts/recover-max-channel-forward.ts apply SOURCE_UUID PLAN_SHA256
```

Run under the existing host operations lock. Store the source ID and plan in a
root-only incident receipt. Do not print message text, media URLs or credentials.
The CLI verifies the configured bot identity. Only a denied, empty, processed,
non-redacted senderless source younger than 24 hours is eligible. The current
connected channel, active family, active owner/full membership and child are
required. The plan binds the exact source, original forward identity, content
hash, attachment identities and binding version. Changed plans fail closed.

Apply atomically reopens that same source/inbox and queues the existing
`max:process` task; it does not write a memory directly. A persistent repair
dedupe key and normal forward deduplication prevent concurrent/repeated copies.
Publication rechecks access and the live binding. Do not reset rows manually,
reenqueue arbitrary inboxes or use this command for channel history import.

After processing, verify the original planned memory ID, family and published
source, exactly one expected media asset, successful private storage read and
scrubbed inbox payload. Check the family feed on a real device separately.

Release uses FULL against the deployed source base and the existing Selectel
runbook. The exact runtime pin retains the designated d299 filesystem-only
recovery profile; it does not permit rollback while S3 is the effective driver.
Restore current S3 bytes under stopped writers and expired upload URLs before
the guarded release, then restore the accepted S3 configuration after promotion.
Verify inventories/hashes and database references at both transitions.
