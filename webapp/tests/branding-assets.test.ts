import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import assetManifest from '../../assets/manifest.json'

const logoPath = path.resolve(import.meta.dir, '../public/assets/brand/memoly-logo.webp')

test('the canonical memoLy logo is a local transparent WebP with preserved intrinsic aspect ratio', async () => {
  const [bytes, metadata, info] = await Promise.all([
    readFile(logoPath),
    sharp(logoPath).metadata(),
    stat(logoPath),
  ])
  const manifestEntry = assetManifest.items.find((item) => item.path === 'assets/brand/memoly-logo.webp')

  expect(metadata.format).toBe('webp')
  expect(metadata.hasAlpha).toBe(true)
  expect(metadata.width).toBe(1154)
  expect(metadata.height).toBe(325)
  expect(metadata.width! / metadata.height!).toBeCloseTo(1154 / 325, 10)
  expect(info.size).toBe(manifestEntry?.bytes)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifestEntry?.sha256)

  const { data, info: rawInfo } = await sharp(logoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const corners = [0, rawInfo.width - 1, (rawInfo.height - 1) * rawInfo.width, rawInfo.height * rawInfo.width - 1]
  expect(corners.map((pixel) => data[pixel * 4 + 3])).toEqual([0, 0, 0, 0])
  expect(data.some((_, index) => index % 4 === 3 && data[index] === 255)).toBe(true)
})
