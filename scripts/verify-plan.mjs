import { appendFileSync, readFileSync } from 'node:fs'

const mapUrl = new URL('../verification-map.json', import.meta.url)

/**
 * This is an execution boundary: verification-map.json can select only these IDs.
 * GitHub Actions maps them to static commands, never to command strings from the map.
 */
export const verificationCommandIds = [
  'architecture',
  'template',
  'typecheck',
  'contracts',
  'backend-unit',
  'backend-integration',
  'webapp',
  'build-webapp',
]

export const fullVerificationCommandIds = [...verificationCommandIds]

const knownCommandIds = new Set(verificationCommandIds)
const verificationControlPaths = [
  '.github/workflows/',
  'verification-map.json',
  'scripts/verify-plan.mjs',
]

export function planVerification(paths, map = readVerificationMap()) {
  validateVerificationMap(map)

  const impacts = []
  const commandIds = new Set()
  const unknownPaths = []

  for (const suppliedPath of paths) {
    const normalizedPath = normalizePath(suppliedPath)

    if (!normalizedPath) {
      unknownPaths.push(suppliedPath)
      continue
    }

    if (isVerificationControlPath(normalizedPath)) return fullVerificationPlan()

    const rules = map.rules.filter(({ prefixes }) =>
      prefixes.some((prefix) => normalizedPath.startsWith(prefix)),
    )

    if (rules.length === 0) {
      unknownPaths.push(suppliedPath)
      continue
    }

    for (const rule of rules) {
      if (!impacts.includes(rule.impact)) impacts.push(rule.impact)
      for (const commandId of rule.commandIds) commandIds.add(commandId)
    }
  }

  if (unknownPaths.length > 0 || paths.length === 0) return fullVerificationPlan(unknownPaths)

  return {
    status: 'ready',
    impacts,
    commandIds: commandIdsInStableOrder(commandIds),
  }
}

function fullVerificationPlan(unknownPaths) {
  return {
    status: 'ready',
    impacts: ['full'],
    commandIds: fullVerificationCommandIds,
    ...(unknownPaths?.length ? { unknownPaths } : {}),
  }
}

function readVerificationMap() {
  return JSON.parse(readFileSync(mapUrl, 'utf8'))
}

function validateVerificationMap(map) {
  if (map.version !== 2 || !Array.isArray(map.rules)) {
    throw new Error('verification-map.json must use version 2 with rules')
  }

  for (const rule of map.rules) {
    if (!rule.impact || !Array.isArray(rule.prefixes) || !Array.isArray(rule.commandIds)) {
      throw new Error('verification-map.json contains an invalid rule')
    }
    for (const commandId of rule.commandIds) {
      if (!knownCommandIds.has(commandId)) {
        throw new Error(`verification-map.json references unknown verification command id "${commandId}"`)
      }
    }
  }
}

function commandIdsInStableOrder(commandIds) {
  return verificationCommandIds.filter((commandId) => commandIds.has(commandId))
}

function isVerificationControlPath(path) {
  return verificationControlPaths.some((controlPath) =>
    controlPath.endsWith('/') ? path.startsWith(controlPath) : path === controlPath,
  )
}

function normalizePath(suppliedPath) {
  if (typeof suppliedPath !== 'string') return undefined
  if (suppliedPath.length === 0 || /[;&|`$<>()\\]/.test(suppliedPath)) return undefined
  if (suppliedPath.startsWith('/') || suppliedPath.split('/').includes('..')) return undefined
  return suppliedPath.replace(/^\.\//, '')
}

function cliPaths(args) {
  if (args.length === 1 && args[0] === '--stdin0') {
    return readFileSync(0, 'utf8').split('\0').filter(Boolean)
  }
  return args
}

if (import.meta.main) {
  const plan = planVerification(cliPaths(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `command_ids=${plan.commandIds.join(',')}\n`)
  }
}
