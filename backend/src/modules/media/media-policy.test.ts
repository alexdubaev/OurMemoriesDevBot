import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

import { MediaFailure } from './domain/errors'
import { detectDeclaredMedia, parseSingleRange } from './domain/media-policy'
import { processPhoto } from './infrastructure/photo-processor'

describe('media policy', () => {
  test('detects supported magic bytes and never trusts HTML or SVG declarations', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(detectDeclaredMedia(png, 'photo', 'image/png')).toBe('image/png')
    expect(() => detectDeclaredMedia(new TextEncoder().encode('<svg><script>'), 'photo', 'image/png'))
      .toThrow(MediaFailure)
    expect(() => detectDeclaredMedia(new TextEncoder().encode('<!doctype html>'), 'photo', 'image/png'))
      .toThrow(MediaFailure)
  })

  test('parses one bounded HTTP byte range and rejects multi-range or unsatisfiable input', () => {
    expect(parseSingleRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseSingleRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 })
    expect(parseSingleRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(() => parseSingleRange('bytes=0-1,4-5', 10)).toThrow(MediaFailure)
    try {
      parseSingleRange('bytes=10-', 10)
      throw new Error('expected an unsatisfiable range')
    } catch (error) {
      expect(error).toMatchObject({ kind: 'range_not_satisfiable' })
    }
  })

  test('normalizes EXIF orientation and produces metadata-free WebP derivatives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-policy-'))
    try {
      const input = join(root, 'rotated.jpg')
      const source = await sharp({
        create: { width: 2, height: 1, channels: 3, background: '#ff0000' },
      }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
      await writeFile(input, source)

      const processed = await processPhoto(input)

      expect(processed.verifiedMime).toBe('image/jpeg')
      expect({ width: processed.width, height: processed.height }).toEqual({ width: 1, height: 2 })
      expect((await sharp(processed.display.bytes).metadata()).format).toBe('webp')
      expect((await sharp(processed.preview.bytes).metadata()).orientation).toBeUndefined()
      expect(processed.originalSha256).toBe(createHash('sha256').update(source).digest('hex'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('decodes a real HEIC orientation sample with the pinned decoder build', async () => {
    const processed = await processPhoto(join(import.meta.dir, 'fixtures/heic-exif-orientation.heic'))
    expect(processed.verifiedMime).toBe('image/heic')
    expect({ width: processed.width, height: processed.height }).toEqual({ width: 480, height: 640 })
    expect((await sharp(processed.display.bytes).metadata()).orientation).toBeUndefined()
  })

  test('rejects an image whose decoded pixel count exceeds the limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-pixels-'))
    try {
      const input = join(root, 'oversized.png')
      await sharp({ create: { width: 6_400, height: 6_400, channels: 3, background: '#fff' } }).png().toFile(input)
      await expect(processPhoto(input)).rejects.toMatchObject({ kind: 'invalid_file' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
