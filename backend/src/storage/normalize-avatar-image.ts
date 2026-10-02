import decodeHeic from 'heic-decode'
import sharp from 'sharp'

const maxPixels = 40_000_000

/** Decode an avatar to an EXIF-oriented JPEG for browser preview/display; never crop or store it. */
export async function normalizeAvatarImage(bytes: Uint8Array, declaredType: string) {
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels, pages: 1 })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) throw new Error('Avatar image exceeds the pixel limit')
  const actualType = typeForFormat(metadata.format)
  if (!actualType || !sameImageType(actualType, declaredType)) throw new Error('Unsupported or mismatched avatar image')
  if (actualType === 'image/heic') {
    const decoded = await decodeHeic({ buffer: bytes })
    const source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)
    const result = await sharp(source, { raw: { width: decoded.width, height: decoded.height, channels: 4 }, limitInputPixels: maxPixels }).jpeg({ quality: 90 }).toBuffer()
    return new Uint8Array(result)
  }
  const result = await image.rotate().jpeg({ quality: 90 }).toBuffer()
  return new Uint8Array(result)
}

function typeForFormat(format?: string) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'heic' || format === 'heif') return 'image/heic'
  return null
}

function sameImageType(detected: string, declared: string) {
  return normalize(detected) === normalize(declared)
}

function normalize(type: string) {
  return type === 'image/heif' ? 'image/heic' : type
}
