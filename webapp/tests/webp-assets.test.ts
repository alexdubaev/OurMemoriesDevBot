import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import assetManifest from '../../assets/manifest.json'
import { resolveWebpIconSource } from '../src/components/webp-icon-manifest'

const requiredNames = [
  'chevron',
  'close',
  'family',
  'home',
  'info',
  'lock',
  'more',
  'note',
  'photo',
  'plus',
  'retry',
  'voice',
  'warning',
] as const

const publicIcons = path.resolve(import.meta.dir, '../public/assets/icons')

test('the runtime icon directory contains complete optimized WebP RGBA pairs', async () => {
  const files = (await readdir(publicIcons)).toSorted()
  const expected = requiredNames
    .flatMap((name) =>
      ['active', 'default'].flatMap((state) =>
        [2, 3].map((density) => `${name}-${state}@${density}x.webp`),
      ),
    )
    .toSorted()

  expect(files).toEqual(expected)

  for (const fileName of files) {
    const density = fileName.includes('@3x') ? 3 : 2
    const iconPath = path.join(publicIcons, fileName)
    const [metadata, file] = await Promise.all([
      sharp(iconPath).metadata(),
      stat(iconPath),
    ])
    const bytes = await readFile(iconPath)
    const canonicalPath = `assets/icons/${fileName}`
    const manifestEntry = assetManifest.items.find((item) => item.path === canonicalPath)
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(density === 3 ? 72 : 48)
    expect(metadata.height).toBe(density === 3 ? 72 : 48)
    expect(metadata.hasAlpha).toBe(true)
    expect(file.size).toBeLessThanOrEqual(6 * 1024)
    expect(file.size).toBe(manifestEntry?.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifestEntry?.sha256)
  }
})

test('runtime icon URLs resolve through the canonical asset manifest', () => {
  expect(resolveWebpIconSource('home', 'active', 2)).toEqual({
    height: 48,
    src: '/assets/icons/home-active@2x.webp',
    width: 48,
  })
  expect(resolveWebpIconSource('voice', 'default', 3)).toEqual({
    height: 72,
    src: '/assets/icons/voice-default@3x.webp',
    width: 72,
  })
})
