import { expect, test } from 'bun:test'
import { isSeenContentVisible, mediaCardSeenReady, SEEN_MIN_DURATION_MS, SeenDwell } from '../src/features/feed/seen-visibility'

test('ready voice and video previews can be seen before playback, while missing or failed media cannot', () => {
  expect(mediaCardSeenReady({ kind: 'voice', objectUrl: 'blob:ready-voice' })).toBe(true)
  expect(mediaCardSeenReady({ kind: 'voice', objectUrl: null })).toBe(false)
  expect(mediaCardSeenReady({ kind: 'video', viewerState: 'ready', previewReady: true })).toBe(true)
  expect(mediaCardSeenReady({ kind: 'video', viewerState: 'loading', previewReady: true })).toBe(false)
  expect(mediaCardSeenReady({ kind: 'video', viewerState: 'error', previewReady: true })).toBe(false)
})

const viewport = { top: 0, bottom: 700, left: 0, right: 390 }

test('visible fraction uses the smaller of portrait content and available viewport', () => {
  expect(isSeenContentVisible({ top: 0, bottom: 2400, height: 2400, left: 0, right: 390, width: 390 }, viewport)).toBe(true)
  expect(isSeenContentVisible({ top: 525, bottom: 875, height: 350, left: 0, right: 390, width: 390 }, viewport)).toBe(true)
  expect(isSeenContentVisible({ top: 526, bottom: 876, height: 350, left: 0, right: 390, width: 390 }, viewport)).toBe(false)
  expect(isSeenContentVisible({ top: 360, bottom: 2760, height: 2400, left: 0, right: 390, width: 390 }, viewport)).toBe(false)
  expect(isSeenContentVisible({ top: 0, bottom: 100, height: 100, left: 370, right: 760, width: 390 }, viewport)).toBe(false)
})

test('dwell needs a continuous full second and interruption resets it', () => {
  const dwell = new SeenDwell()
  expect(dwell.update('a', false, 0)).toBe(false)
  expect(dwell.update('a', true, 0)).toBe(false)
  expect(dwell.update('a', true, SEEN_MIN_DURATION_MS - 1)).toBe(false)
  expect(dwell.update('a', false, SEEN_MIN_DURATION_MS - 1)).toBe(false)
  expect(dwell.update('a', true, 1_500)).toBe(false)
  expect(dwell.update('a', true, 2_500)).toBe(true)
  expect(dwell.update('a', true, 4_000)).toBe(false)
})
