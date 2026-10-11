import { createConnection } from 'node:net'

export type PostgresReadinessOptions = {
  host: string
  port: number
  containerProbe: (args: string[]) => boolean
  endpointProbe: (host: string, port: number) => Promise<boolean>
  delay: (milliseconds: number) => Promise<void>
  attempts?: number
  intervalMs?: number
}

export const postgresReadinessProbeTimeoutMs = 1_000

export async function waitForPostgresReadiness(options: PostgresReadinessOptions) {
  const attempts = options.attempts ?? 30
  const intervalMs = options.intervalMs ?? 1_000

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const containerReady = options.containerProbe([
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      'superuser',
      '-d',
      'web_app_demo_test',
    ])
    if (containerReady && (await options.endpointProbe(options.host, options.port))) return
    await options.delay(intervalMs)
  }

  throw new Error('Timed out waiting for PostgreSQL')
}

export function probeTcpEndpoint(
  host: string,
  port: number,
  timeoutMs = postgresReadinessProbeTimeoutMs,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    let settled = false
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveProbe(ready)
    }

    const socket = createConnection({ host, port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
