import { spawn } from 'node:child_process'

import ffprobe from '@ffprobe-installer/ffprobe'

import type { MediaProbe } from '../application/ports'
import { MediaFailure } from '../domain/errors'

export const probeMedia: MediaProbe = async (inputPath, kind) => {
  const report = await ffprobeJson(inputPath)
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

function ffprobeJson(path: string): Promise<ProbeReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe.path, ['-v', 'error', '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,duration,width,height', '-of', 'json', path],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => { child.kill(); reject(invalid('Проверка медиа превысила лимит времени')) }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) { child.kill(); reject(invalid('Ответ проверки медиа слишком велик')) }
      else stdout.push(chunk)
    })
    child.on('error', () => { clearTimeout(timer); reject(new MediaFailure('storage_unavailable', 'Media probe недоступен')) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(unsupported('Файл не удалось декодировать'))
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as ProbeReport) }
      catch { reject(invalid('Media probe вернул некорректный результат')) }
    })
  })
}

function invalid(message: string) { return new MediaFailure('invalid_file', message) }
function unsupported(message: string) { return new MediaFailure('unsupported_media', message) }
