// Any integration test that connects directly to PostgreSQL must reject unsafe URLs before
// constructing Prisma clients or entering cleanup hooks. The runner applies the same guard
// before migration commands; this protects focused `bun test <file>` invocations too.
// @ts-expect-error Shared runtime guard is JavaScript and has no declaration surface.
import { assertLoopbackTestDatabaseUrl } from '../../../scripts/repo-env.mjs'

export function requireIntegrationDatabaseUrl() {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for backend integration tests')
  assertLoopbackTestDatabaseUrl(databaseUrl, process.env.DATABASE_URL)
  return databaseUrl
}
