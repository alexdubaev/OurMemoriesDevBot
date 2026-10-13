import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '.scratch/diagnostic-dist')
const entries = await readdir(output, { withFileTypes: true })
const files = await listFiles(output)
const htmlPath = path.join(output, 'diagnostic.html')
const html = await readFile(htmlPath, 'utf8')
const css = files.filter((file) => file.endsWith('.css'))
const js = files.filter((file) => file.endsWith('.js'))
const forbidden = files.filter((file) => /(?:^|[\\/])(?:manifest\.webmanifest|private-media-sw\.js)$/.test(file))

if (css.length !== 1 || !/diagnostic-feed-[A-Za-z0-9_-]+\.css$/.test(css[0])) throw new Error(`Expected one diagnostic stylesheet, received ${css.length}`)
if (js.length < 1 || !js.some((file) => /(?:^|[\\/])index-[A-Za-z0-9_-]+\.js$/.test(file))) throw new Error('Diagnostic entry bundle is missing')
if (forbidden.length) throw new Error(`Production PWA files entered diagnostic output: ${forbidden.join(', ')}`)
if (/rel="manifest"|rsms\.me\/inter\/inter\.css/.test(html)) throw new Error('Diagnostic HTML retains the production manifest or external font stylesheet')
if (entries.some((entry) => entry.isFile() && entry.name === 'private-media-sw.js')) throw new Error('Diagnostic output contains the production service worker')
const stylesheetHrefs = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((match) => match[1])
if (stylesheetHrefs.length !== 1 || !new URL(stylesheetHrefs[0], 'http://localhost').pathname.endsWith(`/${css[0].replaceAll('\\', '/')}`)) {
  throw new Error('Diagnostic HTML must link exactly to its emitted diagnostic stylesheet')
}
const cssText = await readFile(path.join(output, css[0]), 'utf8')
if (/@import|!important|@font-face|url\s*\(\s*['"]?(?:https?:)?\/\//i.test(cssText)) {
  throw new Error('Diagnostic stylesheet contains external, forced, or imported styling')
}
if (!/background:\s*#fff/i.test(cssText) || /rsms|inter\.css|memoly-feed\.css|tailwind/i.test(cssText)) {
  throw new Error('Diagnostic stylesheet does not match the isolated plain-feed surface')
}
console.log(`Diagnostic build verified: ${files.length} files, ${js.length} JS assets, ${css.length} CSS asset; no production manifest or service worker.`)

async function listFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(absolute))
    else result.push(path.relative(output, absolute))
  }
  return result
}
