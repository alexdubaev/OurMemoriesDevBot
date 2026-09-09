import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

import decodeHeic from 'heic-decode'
import sharp, { type SharpOptions } from 'sharp'

import { MediaFailure } from '../domain/errors'

const maxPixels = 40_000_000

export type ProcessedPhoto = {
  verifiedMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  originalSha256: string
  width: number
  height: number
  display: { bytes: Uint8Array; sha256: string; width: number; height: number }
  preview: { bytes: Uint8Array; sha256: string; width: number; height: number }
}

export async function processPhoto(inputPath: string): Promise<ProcessedPhoto> {
  try {
    const metadata = await sharp(inputPath, { failOn: 'error', limitInputPixels: maxPixels, pages: 1 }).metadata()
    const verifiedMime = mimeForFormat(metadata.format)
    if (!verifiedMime || !metadata.width || !metadata.height) {
      throw new MediaFailure('unsupported_media', 'Формат изображения не поддерживается')
    }
    if (metadata.width * metadata.height > maxPixels) {
      throw new MediaFailure('invalid_file', 'Изображение превышает допустимый размер')
    }

    const decoded = verifiedMime === 'image/heic'
      ? await decodeHeic({ buffer: await readFile(inputPath) })
      : null
    const source = decoded
      ? { input: Buffer.from(decoded.data.buffer), options: { raw: { width: decoded.width, height: decoded.height, channels: 4 as const } } }
      : { input: inputPath, options: { failOn: 'error' as const, limitInputPixels: maxPixels, pages: 1 } }
    const display = await renderDerivative(source, 1_600, 82)
    const preview = await renderDerivative(source, 720, 78)
    return {
      verifiedMime,
      originalSha256: await sha256File(inputPath),
      width: display.width,
      height: display.height,
      display,
      preview,
    }
  } catch (error) {
    if (error instanceof MediaFailure) throw error
    throw new MediaFailure('invalid_file', 'Изображение не удалось безопасно декодировать')
  }
}

async function renderDerivative(source: { input: string | Buffer; options: SharpOptions }, maximum: number, quality: number) {
  const rendered = await sharp(source.input, source.options)
    .rotate()
    .resize({ width: maximum, height: maximum, fit: 'inside', withoutEnlargement: true })
    // Metadata is intentionally omitted: sharp strips EXIF/XMP, including location, by default.
    .webp({ quality })
    .toBuffer({ resolveWithObject: true })
  return {
    bytes: new Uint8Array(rendered.data),
    sha256: createHash('sha256').update(rendered.data).digest('hex'),
    width: rendered.info.width,
    height: rendered.info.height,
  }
}

async function sha256File(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function mimeForFormat(format: string | undefined): ProcessedPhoto['verifiedMime'] | null {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'heif') return 'image/heic'
  return null
}
