import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from 'bun:test'

test('runs the Prisma CLI with Bun instead of delegating its shebang to Node', async () => {
  const source = await readFile(resolve(import.meta.dirname, 'prisma-generate.mjs'), 'utf8')

  expect(source).toContain("spawnSync('bunx', ['--bun', 'prisma', 'generate']")
})

test('uses the Bun Prisma CLI for migration deployment too', async () => {
  const packageJson = await readFile(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')

  expect(JSON.parse(packageJson).scripts['prisma:deploy']).toBe('bunx --bun prisma migrate deploy')
})
