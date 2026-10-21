import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [root, memoryId, familyId] = process.argv.slice(2)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl, 'TEST_DATABASE_URL is required')
assert.equal(process.env.DATABASE_URL, databaseUrl)
const { createPrisma } = await import(pathToFileURL(resolve(root, 'backend/src/db.ts')).href)
const prisma = createPrisma(databaseUrl)
try {
  const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } })
  const memory = await prisma.memory.findUniqueOrThrow({ where: { id: memoryId } })
  assert.equal(memory.familyId, family.id)
  const updated = await prisma.memory.update({ where: { id: memoryId }, data: { body: 'old runtime wrote on expanded schema' } })
  assert.equal(updated.body, 'old runtime wrote on expanded schema')
  process.stdout.write(JSON.stringify({ success: true, familyId: family.id, memoryId: updated.id }) + '\n')
} finally {
  await prisma.$disconnect()
}
