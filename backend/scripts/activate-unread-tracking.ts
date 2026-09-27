import 'dotenv/config'

import { createPrisma, type DbClient } from '../src/db'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** B0 boundary: first publication, join and activation serialize on the family row. */
export async function activateUnreadFamily(db: DbClient, familyId: string): Promise<'activated' | 'already_active'> {
  if (!uuidPattern.test(familyId)) throw new Error('Invalid family ID')
  return db.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ status: string; activatedAt: Date | null; ordinal: bigint }>>`
      SELECT status, publication_ordinal AS ordinal, unread_tracking_activated_at AS "activatedAt"
        FROM families WHERE id = ${familyId}::uuid FOR UPDATE
    `
    const family = rows[0]
    if (!family || family.status !== 'active') throw new Error('Selected family is missing or inactive')
    if (family.activatedAt !== null) return 'already_active'
    if (family.ordinal !== 0n) throw new Error('Pre-activation publication ordinal is inconsistent; stop rollout')
    const tagged = await transaction.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM memories
         WHERE family_id = ${familyId}::uuid AND first_published_ordinal IS NOT NULL
      ) AS exists
    `
    if (tagged[0]?.exists) throw new Error('Pre-activation Memory ordinal is inconsistent; stop rollout')
    const baselines = await transaction.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM family_members
         WHERE family_id = ${familyId}::uuid AND unread_baseline_ordinal IS NOT NULL
      ) AS exists
    `
    if (baselines[0]?.exists) throw new Error('Pre-activation member baseline is inconsistent; stop rollout')
    await transaction.$executeRaw`
      UPDATE families SET unread_tracking_activated_at = now()
       WHERE id = ${familyId}::uuid AND unread_tracking_activated_at IS NULL
    `
    return 'activated'
  }, { maxWait: 5_000, timeout: 10_000 })
}

export function parseFamilyIds(input: string): string[] {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0 || lines.length > 1_000) throw new Error('Provide 1 to 1000 family IDs on stdin')
  if (lines.some((line) => !uuidPattern.test(line))) throw new Error('Input contains an invalid family ID')
  const ids = lines.map((line) => line.toLowerCase())
  if (new Set(ids).size !== ids.length) throw new Error('Input contains duplicate family IDs')
  return ids
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    throw new Error('Usage: bun scripts/activate-unread-tracking.ts [--apply] < family-ids.txt')
  }
  const ids = parseFamilyIds(await Bun.stdin.text())
  if (args[0] !== '--apply') {
    console.log(`Validated ${ids.length} family IDs; no data changed. Use --apply after release readiness checks.`)
  } else {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) throw new Error('DATABASE_URL is required')
    const db = createPrisma(databaseUrl)
    let activated = 0
    let alreadyActive = 0
    try {
      for (const id of ids) {
        const result = await activateUnreadFamily(db, id)
        if (result === 'activated') activated++
        else alreadyActive++
      }
    } finally {
      await db.$disconnect()
    }
    console.log(`Activation finished: ${activated} newly activated, ${alreadyActive} already active, ${ids.length} selected.`)
  }
}
