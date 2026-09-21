import type { PrivateMediaKind, ReserveMediaUploadRequest } from '@web-app-demo/contracts'

import { MediaFailure } from './errors'

const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])

export function detectDeclaredMedia(
  bytes: Uint8Array,
  kind: PrivateMediaKind,
  declaredMime: ReserveMediaUploadRequest['contentType'],
) {
  const detected = detectMedia(bytes, kind)
  if (!detected || !mimeMatches(detected, declaredMime)) {
    throw new MediaFailure('unsupported_media', 'Файл не соответствует заявленному формату')
  }
  return detected
}

export function detectPhotoMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' {
  const detected = detectMedia(bytes, 'photo')
  if (!detected || !detected.startsWith('image/')) throw new MediaFailure('unsupported_media', 'Файл не является поддерживаемым изображением')
  return detected as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
}

export function parseSingleRange(header: string, total: number) {
  if (!Number.isSafeInteger(total) || total <= 0 || !header.startsWith('bytes=') || header.includes(',')) {
    throw rangeFailure(total)
  }
  const match = header.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (!match[1] && !match[2])) throw rangeFailure(total)
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw rangeFailure(total)
    start = Math.max(0, total - suffix)
    end = total - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : total - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw rangeFailure(total)
    end = Math.min(end, total - 1)
  }
  if (start < 0 || start >= total || end < start) throw rangeFailure(total)
  return { start, end }
}

function detectMedia(bytes: Uint8Array, kind: PrivateMediaKind): ReserveMediaUploadRequest['contentType'] | null {
  if (kind === 'photo') {
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
    if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp'
    if (asciiAt(bytes, 4, 4) === 'ftyp' && heifBrands.has(asciiAt(bytes, 8, 4))) return 'image/heic'
    return null
  }
  if (kind === 'video') {
    if (asciiAt(bytes, 4, 4) !== 'ftyp') return null
    return asciiAt(bytes, 8, 4) === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg'
  if (asciiAt(bytes, 0, 8) === 'OpusHead') return 'audio/opus'
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm'
  if (asciiAt(bytes, 4, 4) === 'ftyp') return 'audio/mp4'
  return null
}

function mimeMatches(detected: string, declared: string) {
  if (detected === declared) return true
  return detected === 'image/heic' && declared === 'image/heif'
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

function asciiAt(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function rangeFailure(total?: number) {
  return new MediaFailure('range_not_satisfiable', 'Запрошенный диапазон недоступен', undefined, { total })
}
