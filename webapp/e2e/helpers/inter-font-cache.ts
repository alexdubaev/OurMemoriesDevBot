import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const stylesheetUrl = 'https://rsms.me/inter/inter.css'
const licenseUrl = 'https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt'
const cacheDirectory = resolve(fileURLToPath(new URL('../.artifacts/font-cache', import.meta.url)))
const stylesheetMaxBytes = 64 * 1024
const fontMaxBytes = 2 * 1024 * 1024
const licenseMaxBytes = 32 * 1024

type CachedResource = {
  url: string
  file: string
  sha256: string
  bytes: number
  contentType: string
}

type FontCacheManifest = {
  format: 1
  stylesheetUrl: string
  stylesheet: CachedResource
  licenseUrl: string
  license: CachedResource
  fonts: CachedResource[]
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function expectedContentType(contentType: string | null, kind: 'css' | 'font' | 'license'): string {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  const accepted = kind === 'css' ? ['text/css'] : kind === 'font' ? ['font/woff2'] : ['text/plain']
  if (!normalized || !accepted.includes(normalized)) {
    throw new Error(`Unexpected Inter ${kind} content type: ${contentType ?? '(missing)'}`)
  }
  return normalized
}

function validateFinalUrl(response: Response, requestedUrl: string, kind: 'css' | 'font' | 'license') {
  const requested = new URL(requestedUrl)
  const finalUrl = new URL(response.url)
  if (finalUrl.protocol !== 'https:' || finalUrl.origin !== requested.origin || finalUrl.pathname !== requested.pathname || finalUrl.search !== requested.search) {
    throw new Error(`Inter ${kind} download changed origin or path: ${requestedUrl} -> ${response.url}`)
  }
}

async function download(url: string, kind: 'css' | 'font' | 'license', limit: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Inter ${kind} download failed (${response.status}): ${url}`)
  validateFinalUrl(response, url, kind)
  const contentType = expectedContentType(response.headers.get('content-type'), kind)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error(`Inter ${kind} exceeds ${limit} bytes: ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > limit) throw new Error(`Inter ${kind} has invalid size ${bytes.byteLength}: ${url}`)
  return { bytes, contentType }
}

function fontUrls(css: string) {
  const urls = new Set<string>()
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+\.woff2(?:\?[^'")]*)?)\1\s*\)/gi)) {
    const url = new URL(match[2]!, stylesheetUrl)
    if (url.protocol !== 'https:' || url.origin !== 'https://rsms.me' || !url.pathname.startsWith('/inter/font-files/')) {
      throw new Error(`Inter stylesheet contains an unexpected font URL: ${url.href}`)
    }
    urls.add(url.href)
  }
  if (urls.size === 0) throw new Error('Inter stylesheet declared no WOFF2 resources')
  return [...urls].sort()
}

async function verifyResource(directory: string, resource: CachedResource, kind: 'css' | 'font' | 'license') {
  if (basename(resource.file) !== resource.file || !Number.isSafeInteger(resource.bytes) || resource.bytes <= 0) {
    throw new Error(`Invalid cached Inter ${kind} manifest entry: ${resource.file}`)
  }
  const bytes = new Uint8Array(await readFile(join(directory, resource.file)))
  if (bytes.byteLength !== resource.bytes || sha256(bytes) !== resource.sha256) {
    throw new Error(`Cached Inter ${kind} failed integrity verification: ${resource.file}`)
  }
  expectedContentType(resource.contentType, kind)
  return bytes
}

export async function loadVerifiedInterFontCache(): Promise<{ manifest: FontCacheManifest; bytesByUrl: Map<string, Uint8Array> }> {
  const manifest = JSON.parse(await readFile(join(cacheDirectory, 'manifest.json'), 'utf8')) as FontCacheManifest
  if (manifest.format !== 1 || manifest.stylesheetUrl !== stylesheetUrl || manifest.licenseUrl !== licenseUrl || manifest.fonts.length === 0) {
    throw new Error('The cached Inter font manifest has an unsupported format or source')
  }
  if (manifest.stylesheet.url !== stylesheetUrl || manifest.license.url !== licenseUrl) throw new Error('The cached Inter font manifest has unexpected resource URLs')
  const stylesheet = await verifyResource(cacheDirectory, manifest.stylesheet, 'css')
  const license = await verifyResource(cacheDirectory, manifest.license, 'license')
  const css = new TextDecoder('utf-8', { fatal: true }).decode(stylesheet)
  const declaredFonts = fontUrls(css)
  const listedFonts = manifest.fonts.map(({ url }) => url).sort()
  if (JSON.stringify(declaredFonts) !== JSON.stringify(listedFonts)) throw new Error('The cached Inter font manifest does not cover the exact WOFF2 URLs declared by its stylesheet')
  const bytesByUrl = new Map<string, Uint8Array>([[stylesheetUrl, stylesheet], [licenseUrl, license]])
  for (const font of manifest.fonts) bytesByUrl.set(font.url, await verifyResource(cacheDirectory, font, 'font'))
  if (license.byteLength > licenseMaxBytes) throw new Error('Cached Inter license exceeds the accepted size')
  return { manifest, bytesByUrl }
}

export async function ensureInterFontCache() {
  try {
    await loadVerifiedInterFontCache()
    return
  } catch (error) {
    // A missing cache is expected on the first run. Existing but invalid cache data is an error;
    // silently replacing it would conceal corruption or an unexpected local modification.
    let cacheManifestExists = false
    try {
      await readFile(join(cacheDirectory, 'manifest.json'))
      cacheManifestExists = true
    } catch (manifestError) {
      if ((manifestError as NodeJS.ErrnoException).code !== 'ENOENT') throw manifestError
    }
    if (cacheManifestExists) throw new Error(`Existing Inter font cache is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }

  const parent = resolve(cacheDirectory, '..')
  const stagingDirectory = `${cacheDirectory}.tmp-${process.pid}-${Date.now()}`
  await mkdir(parent, { recursive: true })
  await mkdir(stagingDirectory)
  try {
    const [stylesheetDownload, licenseDownload] = await Promise.all([
      download(stylesheetUrl, 'css', stylesheetMaxBytes),
      download(licenseUrl, 'license', licenseMaxBytes),
    ])
    const css = new TextDecoder('utf-8', { fatal: true }).decode(stylesheetDownload.bytes)
    const urls = fontUrls(css)
    const fonts: CachedResource[] = []
    for (let start = 0; start < urls.length; start += 4) {
      const batch = await Promise.all(urls.slice(start, start + 4).map(async (url, offset): Promise<CachedResource> => {
        const downloaded = await download(url, 'font', fontMaxBytes)
        const index = start + offset
        const file = `font-${String(index + 1).padStart(2, '0')}.woff2`
        await writeFile(join(stagingDirectory, file), downloaded.bytes, { flag: 'wx' })
        return { url, file, sha256: sha256(downloaded.bytes), bytes: downloaded.bytes.byteLength, contentType: downloaded.contentType }
      }))
      fonts.push(...batch)
    }
    const stylesheet: CachedResource = { url: stylesheetUrl, file: 'inter.css', sha256: sha256(stylesheetDownload.bytes), bytes: stylesheetDownload.bytes.byteLength, contentType: stylesheetDownload.contentType }
    const license: CachedResource = { url: licenseUrl, file: 'OFL.txt', sha256: sha256(licenseDownload.bytes), bytes: licenseDownload.bytes.byteLength, contentType: licenseDownload.contentType }
    await writeFile(join(stagingDirectory, stylesheet.file), stylesheetDownload.bytes, { flag: 'wx' })
    await writeFile(join(stagingDirectory, license.file), licenseDownload.bytes, { flag: 'wx' })
    const manifest: FontCacheManifest = { format: 1, stylesheetUrl, stylesheet, licenseUrl, license, fonts }
    await writeFile(join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await rename(stagingDirectory, cacheDirectory)
    await loadVerifiedInterFontCache()
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw new Error(`Unable to prepare verified Inter E2E font cache: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}
