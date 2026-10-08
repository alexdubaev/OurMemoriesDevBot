import decodeHeic from 'heic-decode'
import sharp from 'sharp'

const maxPixels = 40_000_000

export type AvatarImageBytes = { bytes: Uint8Array; contentType: string }

/** Validate a transient preview, then normalize HEIC/HEIF or preserve supported raster bytes. */
export async function normalizeAvatarImage(bytes: Uint8Array, declaredType: string) {
  const signatureType = typeForSignature(bytes)
  if (!signatureType || !sameImageType(signatureType, declaredType)) throw new Error('Unsupported or mismatched avatar image')

  const image = sharp(bytes, { failOn: 'error', limitInputPixels: maxPixels, pages: 1 })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) throw new Error('Avatar image exceeds the pixel limit')
  const actualType = typeForFormat(metadata.format)
  if (!actualType || !sameImageType(actualType, signatureType)) throw new Error('Unsupported or mismatched avatar image')
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

function typeForSignature(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp') {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
    const end = Math.min(boxSize, bytes.length)
    const compatibleBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'])
    if (boxSize >= 16) {
      for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
        if (compatibleBrands.has(ascii(bytes, offset, offset + 4))) return 'image/heic'
      }
    }
  }
  return null
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function normalize(type: string) {
  return type === 'image/heif' ? 'image/heic' : type
}
