import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const apiUrl = process.env.ACCEPTANCE_API_URL ?? 'http://127.0.0.1:3000'
const viteUrl = process.env.ACCEPTANCE_VITE_URL ?? 'http://127.0.0.1:5173'
const funnelUrl = process.env.ACCEPTANCE_FUNNEL_URL ?? 'https://desktop-7sch55t.tail879033.ts.net'

async function requireResponse(label, url, expectedStatus, json = false) {
  let response
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new Error(`${label} unavailable`)
  }
  if (response.status !== expectedStatus) throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}`)
  if (json && !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`${label} did not return JSON`)
  }
}

function requireCurrentMigrations() {
  const result = spawnSync('bunx', ['--bun', 'prisma', 'migrate', 'status'], {
    cwd: resolve(repositoryRoot, 'backend'),
    encoding: 'utf8',
  })
  const output = `${result.stdout}${result.stderr}`
  if (result.status !== 0 || !output.includes('Database schema is up to date!')) {
    throw new Error('migrations are not current')
  }
}

async function requireDevProcesses() {
  if (process.platform !== 'win32') throw new Error('runtime process inspection is supported by this local Windows preflight only')
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -notmatch "powershell|pwsh|cmd" } | Select-Object -ExpandProperty CommandLine',
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('cannot inspect runtime processes')
  const lines = result.stdout.split(/\r?\n/)
  const count = (pattern) => lines.filter((line) => pattern.test(line)).length
  for (const [name, pattern] of [
    ['API', /src[\\/]+index\.ts/i],
    ['scheduler', /src[\\/]+scheduler\.ts/i],
    ['Vite', /node_modules\\\.bin\\vite\.exe/i],
  ]) {
    const matches = count(pattern)
    if (matches !== 1) throw new Error(`${name} process count is ${matches}, expected 1`)
  }
  const envFile = await readFile(resolve(repositoryRoot, 'backend/.env'), 'utf8')
  if (!/^TELEGRAM_BOT_MODE="?polling"?\s*$/m.test(envFile) || !/^TELEGRAM_BOT_TOKEN="?\S+/m.test(envFile)) {
    throw new Error('bot polling is not configured for the checked API')
  }
}

async function main() {
  await requireResponse('API', `${apiUrl}/health/ready`, 200, true)
  await requireResponse('Vite', `${viteUrl}/`, 200)
  await requireResponse('Funnel root', `${funnelUrl}/`, 200)
  await requireResponse('Funnel API auth boundary', `${funnelUrl}/api/users/me`, 401, true)
  requireCurrentMigrations()
  await requireDevProcesses()
  console.log('acceptance preflight passed')
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
