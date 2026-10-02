import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { avatarImageForDisplay, normalizeAvatarImage } from './normalize-avatar-image'

test('normalizes real HEIC orientation to full-resolution JPEG without cropping', async () => {
  const heic = new Uint8Array(await readFile(new URL('../modules/media/fixtures/heic-exif-orientation.heic', import.meta.url)))
  const jpeg = await normalizeAvatarImage(heic, 'image/heic')
  const metadata = await sharp(jpeg.bytes).metadata()
  expect(metadata.format).toBe('jpeg')
  expect(jpeg.contentType).toBe('image/jpeg')
  expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 480, height: 640 })
  expect(metadata.orientation).toBeUndefined()
})

test('serves EXIF-oriented JPEG original bytes unchanged for browser-native display', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 2, height: 1, channels: 3, background: '#ab2345' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer())
  const display = await avatarImageForDisplay(input, 'image/jpeg')
  expect(display.contentType).toBe('image/jpeg')
  expect(display.bytes).toEqual(input)
  const metadata = await sharp(display.bytes).metadata()
  expect({ width: metadata.width, height: metadata.height, orientation: metadata.orientation }).toEqual({ width: 2, height: 1, orientation: 6 })
})

test('browser-native 48MP JPEG remains byte-identical and displayable', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 8_000, height: 6_000, channels: 3, background: '#fff' } }).jpeg({ quality: 35 }).toBuffer())
  expect(input.byteLength).toBeLessThan(5 * 1024 * 1024)
  const display = await avatarImageForDisplay(input, 'image/jpeg')
  expect(display).toEqual({ bytes: input, contentType: 'image/jpeg' })
  expect((await sharp(display.bytes).metadata()).width).toBe(8_000)
  expect((await sharp(display.bytes).metadata()).height).toBe(6_000)
})

test('PNG alpha is preserved by the display path', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 5, g: 20, b: 40, alpha: 0.25 } } }).png().toBuffer())
  const display = await avatarImageForDisplay(input, 'image/png')
  expect(display.contentType).toBe('image/png')
  expect(display.bytes).toEqual(input)
  expect((await sharp(display.bytes).metadata()).hasAlpha).toBe(true)
})

test('existing HEIC falls back to original MIME and bytes if server decoding is unavailable', async () => {
  const input = new Uint8Array(new TextEncoder().encode('legacy heic bytes that cannot be normalized'))
  const display = await avatarImageForDisplay(input, 'image/heic')
  expect(display.contentType).toBe('image/heic')
  expect(display.bytes).toEqual(input)
})

test('preview still rejects oversized pixel dimensions before format-specific decoding', async () => {
  const input = new Uint8Array(await sharp({ create: { width: 6_400, height: 6_400, channels: 3, background: '#fff' } }).png().toBuffer())
  await expect(normalizeAvatarImage(input, 'image/png')).rejects.toThrow('pixel limit')
})
