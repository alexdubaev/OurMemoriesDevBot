export function voiceWaveformProgress(currentTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return 0
  return Math.min(1, Math.max(0, currentTime / duration))
}

export function isVoiceWaveformPeakPlayed(index: number, peakCount: number, progress: number) {
  return index < Math.ceil(progress * peakCount)
}
