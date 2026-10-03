import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import sharp from 'sharp'

import type { FfmpegRunner } from './ffmpeg-runner'
import { MediaFailure } from '../domain/errors'

export const VIDEO_POSTER_MAX_EDGE = 1_280
export const VIDEO_POSTER_MAX_BYTES = 4 * 1024 * 1024
export const VIDEO_ORIGINAL_MAX_BYTES = 100 * 1024 * 1024
const MAX_PROBE_OUTPUT_BYTES = 1_000_000
const POSTER_DEDUPE_PREFIX = 'media-video-poster:v1:'

export function videoPosterObjectKey(originalKey: string) {
  if (!originalKey.startsWith('media-originals/')) throw new Error('Video original key is outside the media namespace')
  return originalKey.replace('media-originals/', 'media-preview/') + '.poster-v1.jpg'
}

export function videoPosterDedupeKey(mediaId: string) {
  return `${POSTER_DEDUPE_PREFIX}${mediaId}`
}

export type ExtractedVideoPoster = {
  mime: 'image/jpeg'
  bytes: Buffer
  sha256: string
  width: number
  height: number
  durationMs: number
}

/**
 * Extracts a representative private poster from an already-admitted source video. This only
 * measures duration: codec and dimension acceptance belongs to ingestion and must not hide a
 * poster for an older, already-stored video.
 */
export async function extractVideoPoster(
  input: { inputPath: string; outputPath: string; signal?: AbortSignal },
  runner: FfmpegRunner,
): Promise<ExtractedVideoPoster> {
  const deadline = AbortSignal.timeout(60_000)
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline
  const durationMs = await probePosterDuration(input.inputPath, runner, signal)
  const durationSeconds = durationMs / 1_000
  // Start at the intended representative frame, then try two bounded later positions if the
  // clip begins black, with a first-frame fallback for very short files. Retries stay deterministic.
  const seeks = [...[0.1, 0.35, 0.6].map((fraction) => Math.min(durationSeconds * fraction, Math.max(0, durationSeconds - 0.04))), 0]
  let latest: ExtractedVideoPoster | null = null
  try {
    for (const seconds of seeks) {
      await unlink(input.outputPath).catch(() => undefined)
      const extracted = await runner.run(runner.ffmpegPath, [
        '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1',
        '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-ss', seconds.toFixed(3), '-i', input.inputPath,
        '-threads', '1', '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=w='min(${VIDEO_POSTER_MAX_EDGE},iw)':h='min(${VIDEO_POSTER_MAX_EDGE},ih)':force_original_aspect_ratio=decrease,format=yuvj420p`,
        '-q:v', '3', '-fs', String(VIDEO_POSTER_MAX_BYTES), '-f', 'image2', '-y', input.outputPath,
      ], { signal, timeoutMs: 60_000, maxOutputBytes: 128 * 1024 })
      if (extracted.exitCode !== 0) continue
      let file: Buffer
      try { file = await readFile(input.outputPath) } catch { continue }
      if (file.byteLength === 0 || file.byteLength > VIDEO_POSTER_MAX_BYTES) throw new Error('Video poster exceeded its output budget')
      const metadata = await sharp(file, { limitInputPixels: VIDEO_POSTER_MAX_EDGE * VIDEO_POSTER_MAX_EDGE }).metadata()
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height ||
          metadata.width > VIDEO_POSTER_MAX_EDGE || metadata.height > VIDEO_POSTER_MAX_EDGE) {
        throw new Error('Video poster output is not a bounded JPEG')
      }
      latest = {
        mime: 'image/jpeg', bytes: file, sha256: createHash('sha256').update(file).digest('hex'),
        width: metadata.width, height: metadata.height, durationMs,
      }
      const { data: grayscale } = await sharp(file, { limitInputPixels: VIDEO_POSTER_MAX_EDGE * VIDEO_POSTER_MAX_EDGE })
        .greyscale().raw().toBuffer({ resolveWithObject: true })
      let total = 0
      for (const pixel of grayscale) total += pixel
      if (total / grayscale.byteLength >= 16) return latest
    }
    if (latest) return latest
    throw new MediaFailure('unsupported_media', 'Видео не содержит кадра для превью')
  } catch (error) {
    await unlink(input.outputPath).catch(() => undefined)
    throw error
  }
}

async function probePosterDuration(inputPath: string, runner: FfmpegRunner, signal?: AbortSignal) {
  let result
  try {
    result = await runner.run(runner.ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json',
      '-protocol_whitelist', 'file,pipe', inputPath,
    ], { signal, timeoutMs: 15_000, maxOutputBytes: MAX_PROBE_OUTPUT_BYTES })
  } catch {
    throw new MediaFailure('storage_unavailable', 'Media probe недоступен')
  }
  if (result.exitCode !== 0 || result.stdout.length > MAX_PROBE_OUTPUT_BYTES) {
    throw new MediaFailure('unsupported_media', 'Файл не удалось декодировать')
  }
  try {
    const report = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ duration?: string }> }
    const duration = Number(report.format?.duration ?? report.streams?.find((stream) => stream.duration)?.duration)
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new MediaFailure('unsupported_media', 'Длительность видео не подходит для превью')
    }
    return Math.max(1, Math.round(duration * 1_000))
  } catch (error) {
    if (error instanceof MediaFailure) throw error
    throw new MediaFailure('unsupported_media', 'Файл не удалось декодировать')
  }
}
