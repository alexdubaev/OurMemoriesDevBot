import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertDevRuntimeProcesses } from './dev-runtime-processes.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const apiUrl = process.env.ACCEPTANCE_API_URL ?? 'http://127.0.0.1:3000'
const viteUrl = process.env.ACCEPTANCE_VITE_URL ?? 'http://127.0.0.1:5173'
const funnelUrl = process.env.ACCEPTANCE_FUNNEL_URL ?? 'https://desktop-7sch55t.tail879033.ts.net'
const stabilityMs = Number.parseInt(process.env.ACCEPTANCE_STABILITY_MS ?? '15000', 10)

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
    "$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -notmatch 'powershell|pwsh|cmd' } | Select-Object @{n='processId';e={$_.ProcessId}}, @{n='parentProcessId';e={$_.ParentProcessId}}, @{n='commandLine';e={$_.CommandLine}}); $apiListenerProcessIds = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); [PSCustomObject]@{ processes = $processes; apiListenerProcessIds = $apiListenerProcessIds } | ConvertTo-Json -Compress -Depth 3",
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('cannot inspect runtime processes')
  const snapshot = JSON.parse(result.stdout)
  const processes = Array.isArray(snapshot.processes) ? snapshot.processes : [snapshot.processes].filter(Boolean)
  const viteProcessCount = processes.filter((process) => /node_modules[\\/]+\.bin[\\/]vite\.exe/i.test(process.commandLine ?? '')).length
  assertDevRuntimeProcesses({
    processes,
    apiListenerProcessIds: Array.isArray(snapshot.apiListenerProcessIds)
      ? snapshot.apiListenerProcessIds
      : [snapshot.apiListenerProcessIds].filter((processId) => typeof processId === 'number'),
    viteProcessCount,
  })
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
  await new Promise((resolveSleep) => setTimeout(resolveSleep, Number.isFinite(stabilityMs) && stabilityMs > 0 ? stabilityMs : 15_000))
  await requireResponse('API after stability window', `${apiUrl}/health/ready`, 200, true)
  await requireResponse('Funnel API after stability window', `${funnelUrl}/api/users/me`, 401, true)
  await requireDevProcesses()
  console.log('acceptance preflight passed')
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
