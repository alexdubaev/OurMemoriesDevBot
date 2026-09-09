import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const mapUrl = new URL('../verification-map.json', import.meta.url)

export function planVerification(paths, map = readVerificationMap()) {
  const impacts = []
  const commandIds = new Set()
  const unknownPaths = []

  for (const suppliedPath of paths) {
    const normalizedPath = normalizePath(suppliedPath)
    const rule = normalizedPath && map.rules.find(({ prefixes }) =>
      prefixes.some((prefix) => normalizedPath.startsWith(prefix)),
    )

    if (!rule) {
      unknownPaths.push(suppliedPath)
      continue
    }

    if (!impacts.includes(rule.impact)) impacts.push(rule.impact)
    for (const commandId of rule.commandIds) commandIds.add(commandId)
  }

  if (unknownPaths.length > 0 || paths.length === 0) {
    return {
      status: 'needs-expansion',
      impacts: [],
      commands: [],
      ...(unknownPaths.length > 0 ? { unknownPaths } : { unknownPaths: [] }),
    }
  }

  return {
    status: 'ready',
    impacts,
    commands: [...commandIds].map((commandId) => map.commands[commandId]),
  }
}

function readVerificationMap() {
  const map = JSON.parse(readFileSync(mapUrl, 'utf8'))
  if (map.version !== 1 || !map.commands || !Array.isArray(map.rules)) {
    throw new Error('verification-map.json must use version 1 with commands and rules')
  }

  for (const rule of map.rules) {
    if (!rule.impact || !Array.isArray(rule.prefixes) || !Array.isArray(rule.commandIds)) {
      throw new Error('verification-map.json contains an invalid rule')
    }
    for (const commandId of rule.commandIds) {
      if (typeof map.commands[commandId] !== 'string') {
        throw new Error(`verification-map.json references unknown command "${commandId}"`)
      }
    }
  }

  return map
}

function normalizePath(suppliedPath) {
  if (typeof suppliedPath !== 'string') return undefined
  if (suppliedPath.length === 0 || /[;&|`$<>()\\]/.test(suppliedPath)) return undefined
  if (suppliedPath.startsWith('/') || suppliedPath.split('/').includes('..')) return undefined
  return suppliedPath.replace(/^\.\//, '')
}

if (import.meta.main) {
  const plan = planVerification(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (plan.status !== 'ready') process.exitCode = 2
}

export const verificationMapPath = fileURLToPath(mapUrl)
