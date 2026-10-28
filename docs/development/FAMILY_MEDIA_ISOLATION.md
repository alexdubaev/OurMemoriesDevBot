# Family media isolation audit — 2026-10-28

Task: `MEMOLY-FAMILY-MEDIA-ISOLATION`. Base: accepted main
`9024c99d126abfb4d7f2a79c7a31741402574d38`. Production application source observed:
`bb27b7280b6cf799f265e7171737decb08c9ed45` (S3 media).

## Scope and result

The inspected paths already enforce family membership and resource ownership.
No cross-family content disclosure was reproduced. This change adds regression
coverage; it changes no production source, storage keys, credentials, bucket
policy, schema or recovery behavior. No application rollout is needed for tests.

| Path | Enforced boundary | Evidence owner |
| --- | --- | --- |
| Original, display, preview, playback, GET/HEAD/range/conditional reads | Current active family membership, then asset query with both media ID and family ID, before storage reads or 304 | `media-service.ts:content`, `prisma-media-repository.ts:resolveContent`, `media-access.integration.test.ts` |
| Native video playback cookie | Valid current auth session plus the same membership/resource checks on each request | `media/transport/routes.ts`, `family-access.ts`, media integration tests |
| MAX video/poster/readiness | Exact family/reference/source/published-memory binding; poster storage remains family scoped | `max/infrastructure/video-playback.ts`, media and MAX capture integration tests |
| Member avatars | Requester's family membership and target's active membership/current ready avatar | `resolveMemberAvatarContent`, media integration tests |
| Upload/finalize/attach | Server-created keys, current role, uploader/family-scoped reservation and family-scoped attachment lookup | Media integration tests, `media-memory-catalog.ts`, repository composite foreign keys |
| Individual photo download | Uses the guarded original-content endpoint above | Media integration tests |
| Control CSV exports | Exact protected operator allowlist; ordinary family owners/admins denied; these CSVs contain metadata, not photo bytes | `control.integration.test.ts` |

No implemented family photo ZIP export endpoint was found. Product-spec export
requirements are not evidence of a deployed export feature or tested ZIP ACLs.

New tests specifically mix a real owner of family B with family B's URL and
family A's existing published asset ID, and repeat this in both directions.
They compare successful bytes with actual private test objects, check original
and both photo variants, and deny GET/HEAD/range/ETag requests. A revoked viewer
is denied with both an old token and playback cookie. Failed foreign finalize
and attachment attempts leave the original asset intact and publish no memory;
foreign and nonexistent attachments return the same public error.

The MAX extension checks actual proxied range bytes, HEAD, stored poster bytes,
readiness, mixed family/reference IDs and revocation. Only external MAX API/CDN
responses are synthetic; authorization, HTTP handlers, PostgreSQL and private
test storage are real. Poster/readiness APIs retain their existing Bearer-only
family middleware; the native playback cookie exception is for `/content`.

## Validation and operational boundary

Use the existing integration runner and a unique PostgreSQL `*_test` database.
Focused files are media access, MAX capture, MAX legacy video migration, family
access and Control authorization. Run one final FULL on the final checked source;
record SHA/tree, commands, result and independent review in the PR.

A read-only production probe confirmed authenticated HEAD for three active S3
objects and denial of all six unsigned GET/HEAD attempts, with no object keys,
signed URLs, credentials or media bytes emitted. Media bucket versioning remained
never enabled. No synthetic family data was created in production.

Keep the common private media bucket and opaque existing keys. Adding a family
prefix alone would not restrict a shared service credential; a storage-layer
boundary requires appropriately scoped credentials/policies. No prefix migration
or bucket-per-family system is introduced by this audit. Such a migration must
preserve all current object references, late-upload retirement barriers and the
[S3 recovery prerequisites](S3_MEDIA_MIGRATION.md), and requires separate proof.

This audit is not proof against a compromised privileged server/account or an
authorized family member saving and forwarding a photo. S3 is primary storage;
the separate [backup limitation](S3_OPERATIONS_ACCESS.md) remains unchanged.
