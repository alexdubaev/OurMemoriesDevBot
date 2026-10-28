import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { S3StorageConfig } from './config'
import { FilesystemPrivateStorage } from './filesystem-storage'
import { copyFilesystemToS3, inventoryFilesystem, restoreS3ToFilesystem, verifyS3Inventory } from './storage-migration'

const endpoint = process.env.TEST_S3_RETIREMENT_ENDPOINT
const config: S3StorageConfig = { driver: 's3', endpoint: endpoint ?? '', region: process.env.TEST_S3_RETIREMENT_REGION ?? '', bucket: process.env.TEST_S3_RETIREMENT_BUCKET ?? '', accessKeyId: process.env.TEST_S3_RETIREMENT_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.TEST_S3_RETIREMENT_SECRET_ACCESS_KEY ?? '', forcePathStyle: process.env.TEST_S3_RETIREMENT_FORCE_PATH_STYLE === 'true', uploadMaxBytes: 1024 * 1024, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 300 }

;(endpoint ? describe : describe.skip)('filesystem/S3 verified migration roundtrip (real provider)', () => {
  test('copies originals/variants and retirement barriers, resumes exactly, restores bytes and rejects corruption and stale snapshots', async () => {
    const s3 = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED' })
    const scope = `migration-checks/${randomUUID()}/`
    const keys = [`${scope}original`, `${scope}variant`, `${scope}retired`, `${scope}unexpected`]
    const root = await mkdtemp(join(tmpdir(), 'storage-migration-'))
    const source = join(root, 'source'), restored = join(root, 'restored')
    const storage = new FilesystemPrivateStorage({ driver: 'filesystem', root: source, publicBaseUrl: 'http://127.0.0.1', signingKey: Buffer.alloc(32), uploadMaxBytes: 1024 * 1024, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 300 })
    try {
      for (const key of keys.slice(0, 2)) {
        const bytes = Buffer.from(`synthetic photo bytes ${key}`)
        await storage.writeObject({ key, body: new Blob([bytes]).stream(), contentType: 'image/png', contentLength: bytes.length })
      }
      await storage.retireObject(keys[2]!)
      const before = await inventoryFilesystem(source)
      expect(before.objects.length).toBe(2)
      expect(before.retiredKeys).toEqual([keys[2]!])
      expect(await copyFilesystemToS3(source, s3, config, scope)).toEqual(before)
      expect(await copyFilesystemToS3(source, s3, config, scope)).toEqual(before)
      const after = await restoreS3ToFilesystem(restored, s3, config, scope)
      expect(after).toEqual(before)
      expect(await readFile(join(restored, 'objects', keys[0]!))).toEqual(await readFile(join(source, 'objects', keys[0]!)))
      const fsRestored = new FilesystemPrivateStorage({ driver: 'filesystem', root: restored, publicBaseUrl: 'http://127.0.0.1', signingKey: Buffer.alloc(32), uploadMaxBytes: 1024 * 1024, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 300 })
      await expect(fsRestored.createUploadUrl({ key: keys[2]!, contentType: 'image/png', byteSize: 1 })).rejects.toMatchObject({ kind: 'already_exists' })
      await expect(restoreS3ToFilesystem(restored, s3, config, scope)).rejects.toThrow()
      await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: keys[3]!, Body: 'unexpected' }))
      await expect(copyFilesystemToS3(source, s3, config, scope)).rejects.toThrow('migration_unexpected_remote_key')
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: keys[3]! }))
      await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: keys[0]!, Body: 'corrupt', ContentType: 'image/png' }))
      await expect(verifyS3Inventory(s3, config, before, scope)).rejects.toThrow('migration_remote_bytes_mismatch')
      await expect(copyFilesystemToS3(source, s3, config, scope)).rejects.toThrow('migration_remote_bytes_mismatch')
      const raw = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: keys[0]! }))
      expect(await raw.Body?.transformToString()).toBe('corrupt')
      await writeFile(join(source, 'metadata', keys[1]!), JSON.stringify({ contentType: 'image/png', contentLength: 999 }))
      await expect(inventoryFilesystem(source)).rejects.toThrow('migration_metadata_mismatch')
    } finally {
      for (const Key of keys) await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: Key! }))
      s3.destroy()
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
