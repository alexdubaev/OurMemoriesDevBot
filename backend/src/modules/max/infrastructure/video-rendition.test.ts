import { describe, expect, test } from 'bun:test'

import { selectMaxVideoRendition } from './video-rendition'

const rendition = (height: number | null, name: string, contentLength: number | null = 10, width: number | null = null) => ({
  url: `https://maxvd123.okcdn.ru/${name}.mp4`, width, height, contentLength,
})

describe('MAX rendition selection', () => {
  test('accepts sole 720, 1080, and higher-resolution renditions', () => {
    for (const item of [rendition(720, '720'), rendition(1080, '1080'), rendition(2160, '2160'), rendition(4320, '4320')]) {
      expect(selectMaxVideoRendition([item])?.url).toBe(item.url)
    }
  })

  test('prefers the greatest known height at or below 720, then the smallest larger height', () => {
    expect(selectMaxVideoRendition([rendition(1080, '1080'), rendition(480, '480'), rendition(720, '720')])?.height).toBe(720)
    expect(selectMaxVideoRendition([rendition(2160, '2160'), rendition(1080, '1080')])?.height).toBe(1080)
  })

  test('uses null-height candidates after known heights and permits them alone', () => {
    expect(selectMaxVideoRendition([rendition(null, 'unknown'), rendition(1080, 'known')])?.height).toBe(1080)
    expect(selectMaxVideoRendition([rendition(null, 'unknown')])?.url).toContain('/unknown.mp4')
  })

  test('breaks ties deterministically and skips oversized preferred candidates', () => {
    const tied = [rendition(720, 'z', 8, 1280), rendition(720, 'b', 8, 1920), rendition(720, 'a', 8, 1920)]
    expect(selectMaxVideoRendition(tied)?.url).toBe(selectMaxVideoRendition([...tied].reverse())?.url)
    expect(selectMaxVideoRendition(tied, 8)?.url).toBe('https://maxvd123.okcdn.ru/a.mp4')
    expect(selectMaxVideoRendition([rendition(720, 'large', 100), rendition(1080, 'usable', 50)], 60)?.height).toBe(1080)
    const byteTied = [rendition(720, 'unknown-bytes', null), rendition(720, 'larger', 20), rendition(720, 'smaller', 10)]
    expect(selectMaxVideoRendition(byteTied)?.url).toContain('/smaller.mp4')
    expect(selectMaxVideoRendition([...byteTied].reverse())?.url).toContain('/smaller.mp4')
  })

  test('keeps the strict CDN URL allowlist', () => {
    expect(selectMaxVideoRendition([{ ...rendition(720, 'unsafe'), url: 'https://attacker.example/video.mp4' }])).toBeNull()
    expect(selectMaxVideoRendition([{ ...rendition(720, 'http'), url: 'http://maxvd123.okcdn.ru/video.mp4' }])).toBeNull()
  })
})
