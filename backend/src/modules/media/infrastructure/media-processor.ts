import { readFile, unlink } from 'node:fs/promises'

import type { FfmpegRunner } from './ffmpeg-runner'
import { probeMediaWithRunner } from './media-probe'
import { MediaFailure } from '../domain/errors'

export type PreparedMedia = {
  mime: 'audio/mp4' | 'video/mp4'
  durationMs: number
  width: number | null
  height: number | null
  waveform: number[] | null
}

/**
 * Creates a browser-decodable derivative from a private local working copy. Every dynamic value
 * is a distinct argv item; user-controlled names are never interpreted by a shell.
 */
export async function prepareMedia(
  input: { inputPath: string; outputPath: string; kind: 'voice' | 'video'; signal?: AbortSignal },
  runner: FfmpegRunner,
): Promise<PreparedMedia> {
  const args = input.kind === 'voice'
    ? ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input.inputPath, '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-fs', '104857600', '-y', input.outputPath]
    : ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', input.inputPath, '-map', '0:v:0', '-map', '0:a?', '-vf',
        "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,format=yuv420p",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', '-fs', '104857600', '-y', input.outputPath]
  const encoded = await runner.run(runner.ffmpegPath, args, { signal: input.signal, timeoutMs: 4 * 60_000 })
  if (encoded.exitCode !== 0) throw new MediaFailure('unsupported_media', 'Не удалось подготовить воспроизводимую копию')
  const probed = await probeMediaWithRunner(input.outputPath, input.kind, runner)
  return {
    mime: input.kind === 'voice' ? 'audio/mp4' : 'video/mp4',
    durationMs: probed.durationMs,
    width: probed.width,
    height: probed.height,
    waveform: input.kind === 'voice' ? await waveform(input.inputPath, runner, input.signal) : null,
  }
}

async function waveform(inputPath: string, runner: FfmpegRunner, signal?: AbortSignal): Promise<number[]> {
  const rawPath = `${inputPath}.waveform.pcm`
  try {
    const decoded = await runner.run(runner.ffmpegPath, [
      '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', inputPath, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-fs', '10485760', '-f', 's16le', '-y', rawPath,
    ], { signal, timeoutMs: 2 * 60_000 })
    if (decoded.exitCode !== 0) throw new MediaFailure('unsupported_media', 'Не удалось измерить waveform')
    return bucketPeaks(await readFile(rawPath), 48)
  } finally {
    await unlink(rawPath).catch(() => undefined)
  }
}

export function bucketPeaks(bytes: Uint8Array, buckets: number): number[] {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  if (sampleCount === 0) return Array.from({ length: buckets }, () => 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: buckets }, (_, bucket) => {
    const start = Math.floor(bucket * sampleCount / buckets)
    const end = Math.max(start + 1, Math.floor((bucket + 1) * sampleCount / buckets))
    let peak = 0
    for (let index = start; index < Math.min(end, sampleCount); index += 1) {
      peak = Math.max(peak, Math.abs(view.getInt16(index * 2, true)) / 32768)
    }
    return Number(peak.toFixed(4))
  })
}
