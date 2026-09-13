import { expect, test } from 'bun:test'

import { isVoiceWaveformPeakPlayed, voiceWaveformProgress } from '../src/features/feed/voice-waveform'

test('voice waveform starts unplayed', () => {
  expect(voiceWaveformProgress(0, 6)).toBe(0)
})

test('voice waveform reports the played half from audio time', () => {
  const progress = voiceWaveformProgress(3, 6)
  expect(progress).toBe(0.5)
  expect(isVoiceWaveformPeakPlayed(23, 48, progress)).toBe(true)
  expect(isVoiceWaveformPeakPlayed(24, 48, progress)).toBe(false)
})

test('voice waveform reflects a seek immediately', () => {
  expect(voiceWaveformProgress(4.5, 6)).toBe(0.75)
})

test('voice waveform preserves the supplied paused position', () => {
  expect(voiceWaveformProgress(2, 6)).toBe(1 / 3)
})

test('voice waveform is fully played when audio ends', () => {
  expect(voiceWaveformProgress(6, 6)).toBe(1)
})

test('voice waveform safely stays unplayed without a usable duration', () => {
  expect(voiceWaveformProgress(2, 0)).toBe(0)
  expect(voiceWaveformProgress(2, Number.NaN)).toBe(0)
})
