import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { normalizeAvatarImage } from './normalize-avatar-image'

test('normalizes real HEIC orientation to full-resolution JPEG without cropping', async () => {
  const heic = new Uint8Array(await readFile(new URL('../modules/media/fixtures/heic-exif-orientation.heic', import.meta.url)))
  const jpeg = await normalizeAvatarImage(heic, 'image/heic')
  const metadata = await sharp(jpeg).metadata()
  expect(metadata.format).toBe('jpeg')
  expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 480, height: 640 })
  expect(metadata.orientation).toBeUndefined()
})

test('applies EXIF orientation once and keeps the whole portrait image', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 2, height: 1, channels: 3, background: '#ab2345' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer())
  const normalized = await normalizeAvatarImage(input, 'image/jpeg')
  const metadata = await sharp(normalized).metadata()
  expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 1, height: 2 })
  expect(metadata.orientation).toBeUndefined()
})

test('rejects oversized pixel dimensions before format-specific decoding', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 6_400, height: 6_400, channels: 3, background: '#fff' } }).png().toBuffer())
  await expect(normalizeAvatarImage(input, 'image/png')).rejects.toThrow('pixel limit')
})
