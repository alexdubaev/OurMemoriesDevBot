import { S3Client } from '@aws-sdk/client-s3'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { S3StorageConfig } from '../src/storage/config'
import { copyFilesystemToS3, restoreS3ToFilesystem, verifyS3Inventory, writeMigrationInventory } from '../src/storage/storage-migration'

// No automatic env switch or source deletion. The host runbook holds the deploy
// lock and stops all writers before invoking this tool.
const [operation, root, manifest] = process.argv.slice(2)
if (!['copy', 'restore', 'verify'].includes(operation ?? '') || !root || !isAbsolute(root) || !manifest || !isAbsolute(manifest) || process.env.STORAGE_MIGRATION_WRITERS_STOPPED !== 'true') throw new Error('Usage under stopped writers: migrate-private-storage.ts copy|restore|verify ABSOLUTE_ROOT ABSOLUTE_MANIFEST')
const names = ['REGION', 'BUCKET', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'] as const
for (const name of names) if (!process.env[`PRIVATE_STORAGE_${name}`]) throw new Error(`Missing PRIVATE_STORAGE_${name}`)
const endpoint = process.env.PRIVATE_STORAGE_ENDPOINT!
if (new URL(endpoint).protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname)) throw new Error('Remote migration endpoint requires HTTPS')
const config: S3StorageConfig = { driver: 's3', region: process.env.PRIVATE_STORAGE_REGION!, bucket: process.env.PRIVATE_STORAGE_BUCKET!, endpoint, accessKeyId: process.env.PRIVATE_STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.PRIVATE_STORAGE_SECRET_ACCESS_KEY!, forcePathStyle: process.env.PRIVATE_STORAGE_FORCE_PATH_STYLE === 'true', uploadMaxBytes: Number.MAX_SAFE_INTEGER, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 300 }
const s3 = new S3Client({ endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED' })
try {
  const inventory = operation === 'copy' ? await copyFilesystemToS3(root, s3, config) : operation === 'restore' ? await restoreS3ToFilesystem(root, s3, config) : JSON.parse(await readFile(manifest, 'utf8'))
  if (operation === 'verify') await verifyS3Inventory(s3, config, inventory)
  else await writeMigrationInventory(manifest, inventory)
  console.log(JSON.stringify({ operation, objects: inventory.objects.length, bytes: inventory.objects.reduce((sum: number, item: { contentLength: number }) => sum + item.contentLength, 0), retiredKeys: inventory.retiredKeys.length, verified: true }))
} finally { s3.destroy() }
