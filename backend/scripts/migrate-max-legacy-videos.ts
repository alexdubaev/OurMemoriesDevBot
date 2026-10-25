import { chmod, open, readFile } from 'node:fs/promises'
import { createPrisma } from '../src/db'
import { loadEnv } from '../src/env'
import { createPrivateStorage } from '../src/storage'
import { createMaxApi } from '../src/modules/max/infrastructure/max-api'
import { createMaxVideoLegacyMigration, type MaxVideoLegacyPlan } from '../src/modules/max/infrastructure/legacy-video-migration'

const args = parseArgs(Bun.argv.slice(2))
const env = loadEnv(Bun.env)
const prisma = createPrisma(env.DATABASE_URL)
const storageRuntime = createPrivateStorage(env)
const api = args.recoverAll ? undefined : createMaxApi(env.MAX_BOT_TOKEN)
const migration = createMaxVideoLegacyMigration({ prisma, api, storage: storageRuntime.storage })

try {
  if (args.recoverAll) {
    if (args.apply) {
      const result = await migration.recoverAll({ apply: true, batchSize: args.batchSize })
      console.log(JSON.stringify({ inspected: result.inspected, recovered: result.recovered, refused: result.refused, remaining: result.remaining, mode: 'recovery-apply' }))
      if (result.refused > 0 || result.remaining > 0) process.exitCode = 2
    } else {
      const readiness = await migration.recoveryReadiness()
      console.log(JSON.stringify({ total: readiness.total, inspected: readiness.inspected, ready: readiness.ready, missingObjects: readiness.missingObjects, invalid: readiness.invalid.length, mode: 'recovery-readiness' }))
      if (readiness.invalid.length || readiness.missingObjects > 0 || readiness.ready !== readiness.total) process.exitCode = 2
    }
  } else if (args.apply) {
    if (!args.plan) throw new Error('--apply requires --plan <file>')
    const plan = JSON.parse(await readFile(args.plan, 'utf8')) as MaxVideoLegacyPlan
    const reportPath = args.report ?? 'max-legacy-video-apply-report.json'
    const handle = await open(reportPath, 'wx', 0o600)
    let result
    try {
      await handle.chmod(0o600)
      result = await migration.apply(plan, { offset: args.offset, batchSize: args.batchSize })
      await handle.writeFile(JSON.stringify({ version: 1, offset: args.offset, batchSize: args.batchSize, outcomes: result.outcomes }, null, 2), 'utf8')
      await handle.sync()
    } catch (error) {
      await handle.writeFile(JSON.stringify({ version: 1, offset: args.offset, batchSize: args.batchSize, error: 'apply_failed' }, null, 2), 'utf8').catch(() => undefined)
      throw error
    } finally { await handle.close() }
    await chmod(reportPath, 0o600)
    console.log(JSON.stringify({ migrated: result.migrated, alreadyMigrated: result.alreadyMigrated, skipped: result.skipped, reasons: result.reasons, report: reportPath, mode: 'apply' }))
    if (result.skipped > 0) process.exitCode = 2
  } else {
    const candidates: MaxVideoLegacyPlan['candidates'] = []
    const skipped: MaxVideoLegacyPlan['skipped'] = []
    let offset = 0
    let totalRows = 0
    while (true) {
      const page = await migration.inventory({ batchSize: args.batchSize, offset })
      candidates.push(...page.candidates)
      skipped.push(...page.skipped)
      totalRows = page.totalRows
      offset += page.scanned
      if (!page.hasMore || page.scanned === 0) break
    }
    const plan: MaxVideoLegacyPlan = { version: 1, offset: 0, scanned: offset, totalRows, hasMore: false, candidates, skipped }
    const path = args.plan ?? 'max-legacy-video-plan.json'
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(plan, null, 2), 'utf8') } finally { await handle.close() }
    await chmod(path, 0o600)
    console.log(JSON.stringify({ candidates: plan.candidates.length, skipped: plan.skipped.length, plan: path, mode: 'dry-run' }))
  }
} finally {
  await prisma.$disconnect()
}

function parseArgs(values: string[]) {
  let apply = false
  let recoverAll = false
  let plan: string | undefined
  let batchSize = 5
  let offset = 0
  let report: string | undefined
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!
    if (value === '--apply') apply = true
    else if (value === '--recover-all') recoverAll = true
    else if (value === '--plan') plan = values[++index]
    else if (value === '--batch-size') batchSize = Number(values[++index])
    else if (value === '--offset') offset = Number(values[++index])
    else if (value === '--report') report = values[++index]
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10) throw new Error('--batch-size must be between 1 and 10')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('--offset must be a non-negative safe integer')
  return { apply, recoverAll, plan, batchSize, offset, report }
}
