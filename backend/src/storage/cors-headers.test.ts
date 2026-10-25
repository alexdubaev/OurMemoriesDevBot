import { describe, expect, test } from 'bun:test'
import { MEMOLY_CHILDREN_HEADER } from '@web-app-demo/contracts'

import { createApp } from '../app'
import { createPrisma } from '../db'
import { loadEnv } from '../env'

describe('API CORS allow-list', () => {
  test('lets the web client send the children opt-in header', async () => {
    const databaseUrl = 'postgresql://unused:unused@127.0.0.1:1/cors_preflight_test'
    const prisma = createPrisma(databaseUrl)
    const app = createApp({ prisma, env: loadEnv({
      DATABASE_URL: databaseUrl, JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173',
    }) })
    const response = await app.request('/api/v1/families', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': MEMOLY_CHILDREN_HEADER,
    } })
    const allowed = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map((value) => value.trim())
    expect(allowed).toContain(MEMOLY_CHILDREN_HEADER.toLowerCase())
    expect(allowed).toContain('x-memoly-publication-attribution')
    await prisma.$disconnect()
  })
})
