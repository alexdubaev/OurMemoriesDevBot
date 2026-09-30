import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import assetManifest from '../../assets/manifest.json'
import { resolveWebpIconSource } from '../src/components/webp-icon-manifest'

const requiredNames = [
  'calendar',
  'chevron',
  'clock',
  'close',
  'edit',
  'family',
  'gear',
  'heart',
  'heart-filled',
  'home',
  'info',
  'lock',
  'more',
  'palette',
  'help-circle',
  'archive-box',
  'circle-info',
  'pencil',
  'note',
  'photo',
  'fullscreen',
  'pause',
  'play',
  'plus',
  'retry',
  'settings-sliders',
  'star',
  'trash',
  'trash-can',
  'video',
  'voice',
  'warning',
  'user',
] as const

const publicIcons = path.resolve(import.meta.dir, '../public/assets/icons')

test('the runtime icon directory contains complete optimized WebP RGBA pairs', async () => {
  const files = (await readdir(publicIcons)).toSorted()
  const expected = requiredNames
    .flatMap((name) =>
      (['heart', 'heart-filled', 'pause', 'play'].includes(name) ? ['active', 'default', 'white'] : ['active', 'default']).flatMap((state) =>
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
  expect(resolveWebpIconSource('play', 'white', 2)).toEqual({
    height: 48,
    src: '/assets/icons/play-white@2x.webp',
    width: 48,
  })
  expect(resolveWebpIconSource('fullscreen', 'default', 2)).toEqual({
    height: 48,
    src: '/assets/icons/fullscreen-default@2x.webp',
    width: 48,
  })
  expect(resolveWebpIconSource('pause', 'white', 3)).toEqual({
    height: 72,
    src: '/assets/icons/pause-white@3x.webp',
    width: 72,
  })
})

test('note story decorations are transparent optimized WebP assets mirrored to the public tree', async () => {
  const sourceDir = path.resolve(import.meta.dir, '../../assets/feed-notes')
  const publicDir = path.resolve(import.meta.dir, '../public/assets/feed-notes')
  const expected = [
    { height: 76, name: 'note-sun.webp', width: 80 },
    { height: 100, name: 'note-leaf-sprig.webp', width: 76 },
  ]

  expect((await readdir(sourceDir)).toSorted()).toEqual(expected.map(({ name }) => name).toSorted())
  expect((await readdir(publicDir)).toSorted()).toEqual(expected.map(({ name }) => name).toSorted())

  for (const asset of expected) {
    const sourcePath = path.join(sourceDir, asset.name)
    const publicPath = path.join(publicDir, asset.name)
    const sourceBytes = await readFile(sourcePath)
    const manifestEntry = assetManifest.items.find((item) => item.path === `assets/feed-notes/${asset.name}`)
    const [metadata, file] = await Promise.all([sharp(sourcePath).metadata(), stat(sourcePath)])

    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(asset.width)
    expect(metadata.height).toBe(asset.height)
    expect(metadata.hasAlpha).toBe(true)
    expect(file.size).toBeLessThan(20 * 1024)
    expect(file.size).toBe(manifestEntry?.bytes)
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(manifestEntry?.sha256)
    expect(await readFile(publicPath)).toEqual(sourceBytes)
  }
})
