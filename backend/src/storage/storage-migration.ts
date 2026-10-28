import { GetBucketVersioningCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

import type { S3StorageConfig } from './config'
import { FilesystemPrivateStorage } from './filesystem-storage'
import { assertSafeObjectKey } from './object-keys'
import { assertContentType } from './request-guards'
import { isRetiredS3Object as isMarker, s3RetiredObjectDigestMetadataKey, S3PrivateStorage } from './s3-storage'

type Entry = { key: string; contentType: string; contentLength: number; sha256: string }
export type MigrationInventory = { objects: Entry[]; retiredKeys: string[] }

// Call only while every API/worker/scheduler writer is stopped. Copy is additive;
// neither direction removes source files. A failed restore leaves an unpublished directory.
export async function inventoryFilesystem(root: string): Promise<MigrationInventory> {
  root = resolve(root)
  const objects: Entry[] = [], retiredKeys: string[] = []
  const metadataFiles = new Set(await filesUnder(join(root, 'metadata')))
  const markerFiles = new Set(await filesUnder(join(root, 'retired-objects'), true))
  async function visit(relative: string) {
    const path = join(root, 'objects', relative)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('migration_refuses_symlink')
    if (info.isDirectory()) {
      const children = await readdir(path)
      if (!children.length && relative) {
        const key = exactKey(relative)
        const marker = createHash('sha256').update(key).digest('hex')
        if (markerFiles.delete(marker)) {
          if ((await lstat(join(root, 'retired-objects', marker))).size !== 0) throw new Error('migration_invalid_retirement_barrier')
          retiredKeys.push(key)
        }
      }
      for (const child of children.sort()) await visit(relative ? `${relative}/${child}` : child)
    } else if (info.isFile()) {
      const key = exactKey(relative)
      if (!metadataFiles.delete(key) || info.size <= 0) throw new Error('migration_missing_metadata_or_empty_object')
      const metadata = JSON.parse(await readFile(join(root, 'metadata', key), 'utf8'))
      if (metadata.contentLength !== info.size || typeof metadata.contentType !== 'string' || assertContentType(metadata.contentType) !== metadata.contentType) throw new Error('migration_metadata_mismatch')
      objects.push({ key, contentType: metadata.contentType, contentLength: info.size, sha256: await hash(createReadStream(path)) })
    } else throw new Error('migration_refuses_special_file')
  }
  await visit('')
  if (metadataFiles.size || markerFiles.size) throw new Error('migration_unpaired_metadata_or_retirement')
  return { objects, retiredKeys: retiredKeys.sort() }
}

export async function copyFilesystemToS3(root: string, s3: S3Client, config: S3StorageConfig, scope = '') {
  await assertUnversioned(s3, config.bucket)
  const before = await inventoryFilesystem(root)
  // An exclusive, empty/dedicated bucket prevents a failed earlier copy from
  // resurrecting a source object deleted before the final quiesced inventory.
  const expected = new Set([...before.objects.map(x => x.key), ...before.retiredKeys])
  if ([...expected].some(key => !key.startsWith(scope))) throw new Error('migration_key_outside_scope')
  for (const key of await bucketKeys(s3, config.bucket, scope)) if (!expected.has(key)) throw new Error('migration_unexpected_remote_key')
  for (const entry of before.objects) {
    try {
      await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: entry.key, Body: createReadStream(join(root, 'objects', entry.key)), ContentType: entry.contentType, ContentLength: entry.contentLength, IfNoneMatch: '*' }))
    } catch (error) { if (status(error) !== 412) throw error }
    await verifyRemote(s3, config.bucket, entry)
  }
  const storage = new S3PrivateStorage(config, s3)
  for (const key of before.retiredKeys) await storage.retireObject(key)
  if (JSON.stringify(await inventoryFilesystem(root)) !== JSON.stringify(before)) throw new Error('migration_source_changed')
  await verifyS3Inventory(s3, config, before, scope)
  return before
}

export async function verifyS3Inventory(s3: S3Client, config: S3StorageConfig, inventory: MigrationInventory, scope = '') {
  await assertUnversioned(s3, config.bucket)
  const actual = await bucketKeys(s3, config.bucket, scope)
  const expected = [...inventory.objects.map(x => x.key), ...inventory.retiredKeys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('migration_remote_inventory_mismatch')
  for (const entry of inventory.objects) await verifyRemote(s3, config.bucket, entry)
  for (const key of inventory.retiredKeys) {
    const response = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
    const bytes = await response.Body?.transformToByteArray()
    if (!isMarker(response) || bytes?.length !== 32 || createHash('sha256').update(bytes).digest('hex') !== response.Metadata?.[s3RetiredObjectDigestMetadataKey]) throw new Error('migration_remote_retirement_mismatch')
  }
}

export async function restoreS3ToFilesystem(root: string, s3: S3Client, config: S3StorageConfig, scope = ''): Promise<MigrationInventory> {
  await assertUnversioned(s3, config.bucket)
  // Exclusive creation: never overlay an old filesystem snapshot containing
  // objects that have since been deleted in S3.
  await mkdir(root, { mode: 0o700 })
  await mkdir(join(root, 'objects'), { mode: 0o700 })
  await mkdir(join(root, 'metadata'), { mode: 0o700 })
  const storage = new FilesystemPrivateStorage({ driver: 'filesystem', root, publicBaseUrl: 'http://127.0.0.1', signingKey: Buffer.alloc(32), uploadMaxBytes: Number.MAX_SAFE_INTEGER, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 300 })
  const keys = await bucketKeys(s3, config.bucket, scope)
  for (const key of keys) {
    const response = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
    if (!response.Body) throw new Error('migration_remote_body_missing')
    if (isMarker(response)) {
      const bytes = await response.Body.transformToByteArray()
      if (bytes.length !== 32 || createHash('sha256').update(bytes).digest('hex') !== response.Metadata?.[s3RetiredObjectDigestMetadataKey]) throw new Error('migration_invalid_remote_marker')
      await storage.retireObject(key)
    } else {
      await storage.writeObject({ key, body: response.Body.transformToWebStream(), contentType: response.ContentType ?? 'application/octet-stream', contentLength: response.ContentLength ?? 0 })
    }
  }
  const inventory = await inventoryFilesystem(root)
  await verifyS3Inventory(s3, config, inventory, scope)
  return inventory
}

async function verifyRemote(s3: S3Client, bucket: string, entry: Entry) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: entry.key }))
  if (!response.Body) throw new Error('migration_remote_body_missing')
  const digest = await hash(Readable.fromWeb(response.Body.transformToWebStream() as never))
  if (response.ContentLength !== entry.contentLength || response.ContentType !== entry.contentType || digest !== entry.sha256 || isMarker(response)) throw new Error('migration_remote_bytes_mismatch')
}

export async function assertUnversioned(s3: S3Client, bucket: string) {
  const result = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))
  // Empty status means never versioned. Suspended can retain old private bytes;
  // Object Lock necessarily enables versioning. Never silently turn either off.
  if (result.Status !== undefined) throw new Error('migration_requires_never_versioned_bucket')
}

async function bucketKeys(s3: S3Client, bucket: string, scope = '') {
  const keys: string[] = []
  let token: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: scope, ContinuationToken: token }))
    for (const item of page.Contents ?? []) { if (!item.Key) throw new Error('migration_empty_remote_key'); keys.push(exactKey(item.Key)) }
    if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error('migration_invalid_pagination')
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys.sort()
}

async function filesUnder(root: string, optional = false): Promise<string[]> {
  const result: string[] = []
  async function visit(relative: string) {
    const info = await lstat(join(root, relative))
    if (info.isSymbolicLink()) throw new Error('migration_refuses_symlink')
    if (info.isDirectory()) { for (const child of (await readdir(join(root, relative))).sort()) await visit(relative ? `${relative}/${child}` : child) }
    else if (info.isFile()) result.push(relative)
    else throw new Error('migration_refuses_special_file')
  }
  try { await visit('') } catch (error) { if (!optional || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return result
}
function exactKey(key: string) { if (assertSafeObjectKey(key) !== key) throw new Error('migration_noncanonical_key'); return key }
function status(error: unknown) { return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode }
async function hash(stream: AsyncIterable<Uint8Array>) { const digest = createHash('sha256'); for await (const chunk of stream) digest.update(chunk); return digest.digest('hex') }

export async function writeMigrationInventory(path: string, inventory: MigrationInventory) {
  await writeFile(path, `${JSON.stringify(inventory)}\n`, { flag: 'wx', mode: 0o600 })
}
