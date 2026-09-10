import type { MediaProbe } from '../application/ports'
import { MediaFailure } from '../domain/errors'
import { createFfmpegRunner, type FfmpegRunner } from './ffmpeg-runner'

export const probeMedia: MediaProbe = async (inputPath, kind) => probeMediaWithRunner(inputPath, kind, createFfmpegRunner({}))

export async function probeMediaWithRunner(inputPath: string, kind: 'video' | 'voice', runner: FfmpegRunner) {
  const report = await ffprobeJson(inputPath, runner)
  const duration = Number(report.format?.duration ?? report.streams.find((stream) => stream.duration)?.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw invalid('Не удалось определить длительность файла')
  const durationLimit = kind === 'video' ? 180 : 600
  if (duration > durationLimit) throw invalid('Длительность файла превышает лимит')

  if (kind === 'video') {
    const video = report.streams.find((stream) => stream.codec_type === 'video')
    if (!video || !['h264', 'hevc'].includes(video.codec_name ?? '')) {
      throw unsupported('Видео должно использовать H.264 или HEVC')
    }
    const width = Number(video.width)
    const height = Number(video.height)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 3840 || height > 2160) {
      throw invalid('Разрешение видео превышает 4K')
    }
    const audio = report.streams.find((stream) => stream.codec_type === 'audio')
    if (audio && audio.codec_name !== 'aac') throw unsupported('Звуковая дорожка видео должна использовать AAC')
    return { width, height, durationMs: Math.round(duration * 1_000) }
  }

  if (report.streams.some((stream) => stream.codec_type === 'video')) throw unsupported('Голосовой файл не должен содержать видео')
  const audio = report.streams.find((stream) => stream.codec_type === 'audio')
  if (!audio || !['opus', 'aac'].includes(audio.codec_name ?? '')) throw unsupported('Голосовой файл должен использовать Opus или AAC')
  return { width: null, height: null, durationMs: Math.round(duration * 1_000) }
}

type ProbeReport = { format?: { duration?: string; format_name?: string }; streams: Array<{
  codec_type?: string; codec_name?: string; duration?: string; width?: number; height?: number
}> }

async function ffprobeJson(path: string, runner: FfmpegRunner): Promise<ProbeReport> {
  let result
  try {
    result = await runner.run(runner.ffprobePath, ['-v', 'error', '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,duration,width,height', '-of', 'json', path])
  } catch {
    throw new MediaFailure('storage_unavailable', 'Media probe недоступен')
  }
  if (result.exitCode !== 0 || result.stdout.length > 1_000_000) throw unsupported('Файл не удалось декодировать')
  try { return JSON.parse(result.stdout) as ProbeReport }
  catch { throw invalid('Media probe вернул некорректный результат') }
}

function invalid(message: string) { return new MediaFailure('invalid_file', message) }
function unsupported(message: string) { return new MediaFailure('unsupported_media', message) }
