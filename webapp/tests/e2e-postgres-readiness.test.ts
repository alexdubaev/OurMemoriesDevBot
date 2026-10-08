import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'
import { waitForPostgresReadiness } from '../e2e/helpers/postgres-readiness'
import { probeTcpEndpoint } from '../e2e/helpers/postgres-readiness'

describe('E2E PostgreSQL readiness', () => {
  test('uses explicit TCP for the container probe and waits for the configured endpoint', async () => {
    const containerArgs: string[][] = []
    const endpointArgs: [string, number][] = []
    let endpointAttempts = 0

    await waitForPostgresReadiness({
      host: 'db.example.test',
      port: 45_281,
      containerProbe: (args) => {
        containerArgs.push(args)
        return true
      },
      endpointProbe: async (host, port) => {
        endpointArgs.push([host, port])
        endpointAttempts += 1
        return endpointAttempts >= 2
      },
      delay: async () => {},
    })

    expect(containerArgs[0]).toContain('-h')
    expect(containerArgs[0]).toContain('127.0.0.1')
    expect(endpointArgs).toEqual([
      ['db.example.test', 45_281],
      ['db.example.test', 45_281],
    ])
  })

  test('fails closed when the configured endpoint never becomes ready', async () => {
    let containerAttempts = 0
    let endpointAttempts = 0
    let delays = 0

    await expect(
      waitForPostgresReadiness({
        host: '127.0.0.1',
        port: 45_281,
        attempts: 3,
        intervalMs: 25,
        containerProbe: () => {
          containerAttempts += 1
          return true
        },
        endpointProbe: async () => {
          endpointAttempts += 1
          return false
        },
        delay: async (milliseconds) => {
          expect(milliseconds).toBe(25)
          delays += 1
        },
      }),
    ).rejects.toThrow(/Timed out/)

    expect(containerAttempts).toBe(3)
    expect(endpointAttempts).toBe(3)
    expect(delays).toBe(3)
  })

  test('retries a failed container TCP probe before checking the endpoint', async () => {
    const calls: string[] = []

    await waitForPostgresReadiness({
      host: 'localhost',
      port: 5_432,
      containerProbe: () => {
        calls.push('container')
        return calls.filter((call) => call === 'container').length > 1
      },
      endpointProbe: async () => {
        calls.push('endpoint')
        return true
      },
      delay: async () => {},
    })

    expect(calls).toEqual(['container', 'container', 'endpoint'])
  })

  test('supports an external endpoint without Docker and closes successful TCP probes', async () => {
    const server = createServer()
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address')

    try {
      const endpointChecks: [string, number][] = []
      await waitForPostgresReadiness({
        host: '127.0.0.1',
        port: address.port,
        containerProbe: () => true,
        endpointProbe: (host, port) => {
          endpointChecks.push([host, port])
          return probeTcpEndpoint(host, port, 250)
        },
        delay: async () => {},
      })

      expect(endpointChecks).toEqual([['127.0.0.1', address.port]])
      expect(await probeTcpEndpoint('127.0.0.1', address.port, 250)).toBe(true)
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      )
    }

    const closedServer = createServer()
    await new Promise<void>((resolveListen) => closedServer.listen(0, '127.0.0.1', resolveListen))
    const closedAddress = closedServer.address()
    if (!closedAddress || typeof closedAddress === 'string') throw new Error('Expected TCP server address')
    await new Promise<void>((resolveClose, rejectClose) =>
      closedServer.close((error) => (error ? rejectClose(error) : resolveClose())),
    )
    expect(await probeTcpEndpoint('127.0.0.1', closedAddress.port, 250)).toBe(false)
  })
})
