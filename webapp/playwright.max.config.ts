import baseConfig from './playwright.config'
import { defineConfig } from '@playwright/test'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** FULL verification uses active MAX/platform-neutral journeys and excludes the legacy Telegram smoke. */
const webServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer.map((server) => server.name === 'backend'
    ? {
      ...server,
      command: 'bun run scripts/max-verification-server.ts',
      env: { ...server.env, TEST_DATABASE_URL: server.env?.DATABASE_URL ?? '', MULTI_FAMILY_ACTIVATION: 'on' },
    }
    : server)
  : baseConfig.webServer

const webappRoot = fileURLToPath(new URL('.', import.meta.url))
const backendRoot = resolve(webappRoot, '../backend')
const familyAuditRunId = process.env.MAX_FAMILY_AUDIT_RUN_ID ?? randomUUID()
if (!/^[a-zA-Z0-9-]{1,64}$/.test(familyAuditRunId)) throw new Error('MAX_FAMILY_AUDIT_RUN_ID must be a simple unique identifier')
const reservedPorts = new Set([Number(process.env.E2E_BACKEND_PORT), Number(process.env.E2E_WEB_PORT)])
const familyApiPort = await resolveFamilyAuditPort('MAX_FAMILY_AUDIT_API_PORT', 56601, reservedPorts)
const familyWebPort = await resolveFamilyAuditPort('MAX_FAMILY_AUDIT_WEB_PORT', 56602, reservedPorts)
process.env.MAX_FAMILY_AUDIT_RUN_ID = familyAuditRunId
process.env.MAX_FAMILY_AUDIT_API_PORT = String(familyApiPort)
process.env.MAX_FAMILY_AUDIT_WEB_PORT = String(familyWebPort)
const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const familyAuditServers = [
  {
    name: 'max-family-audit-backend',
    command: 'bun run src/modules/families/test-support/max-family-audit-server.ts',
    cwd: backendRoot,
    url: `http://127.0.0.1:${familyApiPort}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, MAX_FAMILY_AUDIT_RUN_ID: familyAuditRunId, MAX_FAMILY_AUDIT_API_PORT: String(familyApiPort), MAX_FAMILY_AUDIT_WEB_PORT: String(familyWebPort), TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl, PORT: String(familyApiPort) },
  },
  {
    name: 'max-family-audit-web',
    command: `bun run build -- --config e2e/max-family-audit.vite.config.ts && bunx vite preview --config e2e/max-family-audit.vite.config.ts --host 127.0.0.1 --port ${familyWebPort} --strictPort`,
    cwd: webappRoot,
    url: `http://127.0.0.1:${familyWebPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, VITE_MAX_BOT_USERNAME: 'OurMemoriesMaxBot', VITE_MEMOLY_UI_VERSION: 'v2', MAX_FAMILY_AUDIT_API_PORT: String(familyApiPort) },
  },
]

async function resolveFamilyAuditPort(envName: string, preferredPort: number, reserved: Set<number>) {
  const explicit = process.env[envName]
  if (explicit !== undefined) {
    const port = Number(explicit)
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || reserved.has(port)) throw new Error(`${envName} must be a free, distinct TCP port`)
    reserved.add(port)
    return port
  }
  for (let port = preferredPort; port < preferredPort + 1_000 && port <= 65_535; port += 1) {
    if (reserved.has(port) || !(await isPortAvailable(port))) continue
    reserved.add(port)
    return port
  }
  throw new Error(`Could not find a free ${envName} port.`)
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolveAvailability) => {
    const server = createServer()
    server.once('error', () => resolveAvailability(false))
    server.once('listening', () => server.close(() => resolveAvailability(true)))
    server.listen({ host: '127.0.0.1', port })
  })
}

export default defineConfig({
  ...baseConfig,
  webServer: [...(Array.isArray(webServer) ? webServer : webServer ? [webServer] : []), ...familyAuditServers],
  metadata: { ...baseConfig.metadata, commentsServerMode: 'dev-strict' },
  testMatch: [
    '**/max-browser-link.spec.ts',
    '**/albums.spec.ts',
    '**/gifts.spec.ts',
    '**/comments.spec.ts',
      '**/shared-author-avatar.spec.ts',
    '**/comments-state.spec.ts',
    '**/memoly-v4.spec.ts',
    '**/voice-player.spec.ts',
    '**/video-lifecycle.spec.ts',
    '**/max-family-audit.max-e2e.ts',
  ],
  projects: [
    {
      name: 'max-core',
      use: { browserName: 'chromium' },
        testMatch: ['**/max-browser-link.spec.ts', '**/albums.spec.ts', '**/gifts.spec.ts', '**/comments.spec.ts', '**/comments-state.spec.ts', '**/memoly-v4.spec.ts', '**/voice-player.spec.ts', '**/video-lifecycle.spec.ts', '**/shared-author-avatar.spec.ts'],
    },
    {
      name: 'max-family-scope',
      use: { browserName: 'chromium', baseURL: `http://127.0.0.1:${familyWebPort}` },
      testMatch: '**/max-family-audit.max-e2e.ts',
      grep: /MAX-FULL:/,
    },
  ],
})
