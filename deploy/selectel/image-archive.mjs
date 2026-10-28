// Run with the accepted backend image's existing AWS SDK, never with runtime
// container configuration/volumes as archive input. No secret values are logged.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { isAbsolute } from 'node:path'

const [operation, path, expectedHash] = process.argv.slice(2)
if (!['upload', 'restore'].includes(operation) || !path || !isAbsolute(path)) throw Error('Usage: image-archive.mjs upload ABSOLUTE_FILE | restore NEW_ABSOLUTE_FILE SHA256')
const env = process.env
if (env.RELEASE_ARCHIVE_BUCKET !== 'memoly-release-archives') throw Error('Dedicated release archive bucket required')
for (const name of ['REGION', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) if (!env[`PRIVATE_STORAGE_${name}`]) throw Error('Incomplete protected archive credentials')
const endpoint = new URL(env.PRIVATE_STORAGE_ENDPOINT)
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password) throw Error('Archive endpoint must be a plain HTTPS origin')
const client = new S3Client({ endpoint: endpoint.origin, region: env.PRIVATE_STORAGE_REGION, forcePathStyle: false,
  credentials: { accessKeyId: env.PRIVATE_STORAGE_ACCESS_KEY_ID, secretAccessKey: env.PRIVATE_STORAGE_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED' })
const Bucket = env.RELEASE_ARCHIVE_BUCKET
let phase = 'input'
function key(hash) { if (!/^[0-9a-f]{64}$/.test(hash ?? '')) throw Error('Trusted SHA-256 required'); return `docker-images/${hash}.tar.gz` }
async function digestFile(file) { const hash = createHash('sha256'); for await (const part of createReadStream(file)) hash.update(part); return hash.digest('hex') }
async function verifyRemote(Key, hash, expectedSize) {
  const result = await client.send(new GetObjectCommand({ Bucket, Key }))
  if (!result.Body || result.Metadata?.sha256 !== hash || (expectedSize !== undefined && result.ContentLength !== expectedSize)) throw Error('Archive metadata mismatch')
  const digest = createHash('sha256'); let bytes = 0
  for await (const part of Readable.fromWeb(result.Body.transformToWebStream())) { digest.update(part); bytes += part.length }
  if (digest.digest('hex') !== hash || bytes !== result.ContentLength) throw Error('Archive bytes mismatch')
  return bytes
}
try {
  if (operation === 'upload') {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 5 * 1024 ** 3) throw Error('Archive must be a regular file up to 5 GiB')
    const hash = await digestFile(path), Key = key(hash)
    phase = 'put'
    try {
      await client.send(new PutObjectCommand({ Bucket, Key, Body: createReadStream(path), ContentLength: info.size,
        ContentType: 'application/gzip', Metadata: { sha256: hash }, IfNoneMatch: '*' }))
    } catch (error) { if (error?.$metadata?.httpStatusCode !== 412) throw error }
    phase = 'verify-get'
    await verifyRemote(Key, hash, info.size)
    const unsigned = new URL(endpoint.origin); unsigned.hostname = `${Bucket}.${unsigned.hostname}`; unsigned.pathname = `/${Key}`
    phase = 'anonymous-head'
    const anonymous = await fetch(unsigned, { method: 'HEAD' })
    if (![403, 404].includes(anonymous.status)) throw Error('Archive is not private')
    console.log(JSON.stringify({ operation, bucket: Bucket, key: Key, sha256: hash, bytes: info.size, remoteBytesVerified: true, private: true }))
  } else {
    const Key = key(expectedHash)
    phase = 'restore-head'
    const head = await client.send(new HeadObjectCommand({ Bucket, Key }))
    if (head.Metadata?.sha256 !== expectedHash || !head.ContentLength) throw Error('Archive metadata mismatch')
    phase = 'restore-get'
    const result = await client.send(new GetObjectCommand({ Bucket, Key }))
    if (!result.Body) throw Error('Archive body missing')
    const hash = createHash('sha256'); let bytes = 0; let created = false
    const output = createWriteStream(path, { flags: 'wx', mode: 0o600 })
    output.on('open', () => { created = true })
    try {
      const check = new Transform({ transform(part, _encoding, callback) { hash.update(part); bytes += part.length; callback(null, part) } })
      await pipeline(Readable.fromWeb(result.Body.transformToWebStream()), check, output)
      if (bytes !== head.ContentLength || hash.digest('hex') !== expectedHash) throw Error('Restored archive bytes mismatch')
    } catch (error) { if (created) await unlink(path); throw error }
    console.log(JSON.stringify({ operation, bucket: Bucket, key: Key, sha256: expectedHash, bytes, restoredBytesVerified: true }))
  }
} catch (error) {
  console.error(JSON.stringify({ failed: true, phase, error: error?.name ?? 'Error', status: error?.$metadata?.httpStatusCode }))
  process.exitCode = 1
} finally { client.destroy() }
