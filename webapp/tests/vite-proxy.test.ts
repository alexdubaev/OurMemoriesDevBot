import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('proxies same-origin API and storage paths to the local backend by default', () => {
  const configPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
  const config = readFileSync(configPath, 'utf8')

  expect(config).toContain("const backendProxyTarget = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000'")
  expect(config).toContain("allowedHosts: ['desktop-7sch55t.tail879033.ts.net']")
  expect(config).toContain("'/api': { target: backendProxyTarget, changeOrigin: true }")
  expect(config).toContain("'/storage': { target: backendProxyTarget, changeOrigin: true }")
})
