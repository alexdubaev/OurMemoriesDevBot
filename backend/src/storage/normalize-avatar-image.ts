import decodeHeic from 'heic-decode'
import sharp from 'sharp'

const maxPixels = 40_000_000

export type AvatarImageBytes = { bytes: Uint8Array; contentType: string }

/** Validate a transient preview, then normalize HEIC/HEIF or preserve supported raster bytes. */
export async function normalizeAvatarImage(bytes: Uint8Array, declaredType: string) {
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels, pages: 1 })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) throw new Error('Avatar image exceeds the pixel limit')
  const actualType = typeForFormat(metadata.format)
  if (!actualType || !sameImageType(actualType, declaredType)) throw new Error('Unsupported or mismatched avatar image')
  if (actualType === 'image/jpeg' || actualType === 'image/png' || actualType === 'image/webp') {
    return { bytes, contentType: declaredType } satisfies AvatarImageBytes
  }
  if (actualType === 'image/heic') {
    const decoded = await decodeHeic({ buffer: bytes })
    const source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)
    const result = await sharp(source, { raw: { width: decoded.width, height: decoded.height, channels: 4 }, limitInputPixels: maxPixels }).jpeg({ quality: 90 }).toBuffer()
    return { bytes: new Uint8Array(result), contentType: 'image/jpeg' } satisfies AvatarImageBytes
  }
  throw new Error('Unsupported avatar image type')
}

/** Existing HEIC originals stay readable on runtimes without the HEIC decoder. */
export async function avatarImageForDisplay(bytes: Uint8Array, declaredType: string): Promise<AvatarImageBytes> {
  if (declaredType !== 'image/heic' && declaredType !== 'image/heif') return { bytes, contentType: declaredType }
  try {
    return await normalizeAvatarImage(bytes, declaredType)
  } catch {
    return { bytes, contentType: declaredType }
  }
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
