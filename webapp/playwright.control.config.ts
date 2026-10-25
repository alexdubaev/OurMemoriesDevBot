import baseConfig from './playwright.config'
import { defineConfig } from '@playwright/test'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const webappRoot = fileURLToPath(new URL('.', import.meta.url))
const backendRoot = resolve(webappRoot, '../backend')
const runId = process.env.CONTROL_E2E_RUN_ID ?? randomUUID()
if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('CONTROL_E2E_RUN_ID must be a simple unique identifier')
const reserved = new Set([Number(process.env.E2E_BACKEND_PORT), Number(process.env.E2E_WEB_PORT)])
const apiPort = await portFor('CONTROL_E2E_API_PORT', 56701)
const webPort = await portFor('CONTROL_E2E_WEB_PORT', 56702)
process.env.CONTROL_E2E_RUN_ID = runId
process.env.CONTROL_E2E_API_PORT = String(apiPort)
process.env.CONTROL_E2E_WEB_PORT = String(webPort)
const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://127.0.0.1:${webPort}`
process.env.VITE_API_URL = apiOrigin
process.env.CONTROL_E2E_WEB_ORIGIN = webOrigin

async function portFor(envName: string, preferred: number) {
  if (process.env[envName] !== undefined) {
    const port = Number(process.env[envName])
    if (!Number.isInteger(port) || port < 1 || port > 65535 || reserved.has(port)) throw new Error(`${envName} must be a free, distinct TCP port`)
    reserved.add(port)
    return port
  }
  for (let port = preferred; port < preferred + 1000 && port <= 65535; port += 1) {
    if (reserved.has(port) || !(await isAvailable(port))) continue
    reserved.add(port)
    return port
  }
  throw new Error(`Could not find a free ${envName} port`)
}

function isAvailable(port: number) {
  return new Promise<boolean>((resolveAvailability) => {
    const server = createServer()
    server.once('error', () => resolveAvailability(false))
    server.once('listening', () => server.close(() => resolveAvailability(true)))
    server.listen({ host: '127.0.0.1', port })
  })
}

export default defineConfig({
  ...baseConfig,
  testMatch: '**/control-browser-link.spec.ts',
  use: { ...baseConfig.use, baseURL: webOrigin },
  projects: [
    { name: 'control-chromium', use: { browserName: 'chromium' } },
    { name: 'control-webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [
    {
      name: 'control-e2e-backend',
      command: 'bun run src/modules/control/test-support/control-e2e-server.ts',
      cwd: backendRoot,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, CONTROL_E2E_RUN_ID: runId, CONTROL_E2E_API_PORT: String(apiPort), CONTROL_E2E_WEB_PORT: String(webPort), TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl, PORT: String(apiPort) },
    },
    {
      name: 'control-e2e-web',
      command: `bun run build && bunx vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: webappRoot,
      url: `http://127.0.0.1:${webPort}/control/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, VITE_MAX_BOT_USERNAME: 'OurMemoriesMaxBot', VITE_API_URL: apiOrigin },
    },
  ],
})
