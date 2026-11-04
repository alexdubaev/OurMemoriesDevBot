import { createTelegramAuthOnlyFixture } from '../src/modules/auth/test-support/telegram-auth-only-fixture'

// No bot startup, webhook, polling or real provider. The fixture validates loopback *_test DB
// isolation before connecting; its createApp uses the actual auth/family/private-media routes.
const fixture = await createTelegramAuthOnlyFixture(process.env.CORS_ORIGINS ?? '',
  new Uint8Array(await Bun.file(new URL('../src/modules/auth/test-support/telegram-playback-av.mp4', import.meta.url)).arrayBuffer()))
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch: async (request) => {
  // Test runner teardown also runs after a failed assertion. Windows process termination does
  // not guarantee signal delivery, so dispose this run's fixture before Playwright stops us.
  if (request.method === 'POST' && new URL(request.url).pathname === '/__fixture/cleanup') {
    await fixture.close()
    return new Response(null, { status: 204 })
  }
  return fixture.app.fetch(request)
} })
console.log(`Telegram auth-only verification backend listening on ${server.url}`)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await server.stop(true)
  await fixture.close()
  process.exit(0)
}
process.on('SIGTERM', () => { void stop() })
process.on('SIGINT', () => { void stop() })
