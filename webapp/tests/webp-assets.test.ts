import { expect, test } from 'bun:test'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

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
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(density === 3 ? 72 : 48)
    expect(metadata.height).toBe(density === 3 ? 72 : 48)
    expect(metadata.hasAlpha).toBe(true)
    expect(file.size).toBeLessThanOrEqual(6 * 1024)
  }
})
