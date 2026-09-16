import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import {
  createBootstrapDiagnosticRecorder,
  type BootstrapDiagnosticRecorder,
} from '../src/platform/bootstrap-diagnostic'

describe('MAX pre-auth bootstrap diagnostics', () => {
  test('emits markers with the exact credential-free request init', () => {
    const requests: Array<{ path: string; init: RequestInit }> = []
    const recorder = createBootstrapDiagnosticRecorder((path, init) => {
      requests.push({ path, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    })

    recorder.markIndexInlineStart()
    recorder.markMainModuleEvaluated()
    recorder.markHostDetected('max', true, true)
    recorder.markAuthStarted()

    expect(requests.map(({ path }) => path)).toEqual([
      '/__diag/index-inline-start',
      '/__diag/main-module-evaluated',
      '/__diag/host-detected/max/webapp-true/initdata-true',
      '/__diag/auth-started',
    ])
    for (const request of requests) {
      expect(request.init).toEqual({
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        body: null,
      })
    }
  })

  test('rejects arbitrary diagnostic paths and error/stage values', () => {
    const requests: string[] = []
    const recorder = createBootstrapDiagnosticRecorder((path) => {
      requests.push(path)
      return Promise.resolve(new Response(null, { status: 204 }))
    })

    expect(recorder.emit('/__diag/not-allowlisted')).toBe(false)
    expect(recorder.emit('/__diag/uncaught-error/CustomError/runtime')).toBe(false)
    expect(recorder.markUncaughtError('CustomError', 'runtime')).toBe(false)
    expect(recorder.markUncaughtError('TypeError', 'main-bootstrap')).toBe(true)
    expect(requests).toEqual(['/__diag/uncaught-error/TypeError/main-bootstrap'])
  })

  test('records only controlled host and boolean variants', () => {
    const requests: string[] = []
    const recorder = createBootstrapDiagnosticRecorder((path) => {
      requests.push(path)
      return Promise.resolve(new Response(null, { status: 204 }))
    })

    recorder.markHostDetected('telegram', true, false)
    recorder.markHostDetected('browser', false, false)
    recorder.markHostDetected('unknown', true, true)

    expect(requests).toEqual([
      '/__diag/host-detected/telegram/webapp-true/initdata-false',
      '/__diag/host-detected/browser/webapp-false/initdata-false',
      '/__diag/host-detected/unknown/webapp-true/initdata-true',
    ])
  })

  test('index recorder marker precedes unchanged external SDK and module script order', () => {
    const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
    const html = readFileSync(indexPath, 'utf8')
    const inlineMarker = html.indexOf('/__diag/index-inline-start')
    const maxScript = '<script src="https://st.max.ru/js/max-web-app.js"></script>'
    const telegramScript = '<script src="https://telegram.org/js/telegram-web-app.js?63"></script>'
    const moduleScript = '<script type="module" src="/src/main.tsx"></script>'

    expect(inlineMarker).toBeGreaterThanOrEqual(0)
    expect(inlineMarker).toBeLessThan(html.indexOf(maxScript))
    expect(html.indexOf(maxScript)).toBeLessThan(html.indexOf(telegramScript))
    expect(html.indexOf(telegramScript)).toBeLessThan(html.indexOf(moduleScript))
    expect(html).toContain(maxScript)
    expect(html).toContain(telegramScript)
    expect(html).toContain(moduleScript)
  })

  test('inline recorder handles browser error events without throwing', async () => {
    const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
    const html = readFileSync(indexPath, 'utf8')
    const inlineScript = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1]
    expect(inlineScript).toBeDefined()

    const requests: string[] = []
    let errorListener: ((event: { error?: { name?: unknown } }) => void) | null = null
    const window = {
      fetch: (path: string) => {
        requests.push(path)
        return Promise.resolve()
      },
      addEventListener: (type: string, listener: (event: { error?: { name?: unknown } }) => void) => {
        if (type === 'error') errorListener = listener
      },
    }

    runInNewContext(inlineScript!, { window })
    expect(errorListener).not.toBeNull()
    expect(() => errorListener!({ error: { name: 'TypeError' } })).not.toThrow()
    await Promise.resolve()

    expect(requests).toContain('/__diag/uncaught-error/TypeError/index-inline')
  })

  test('stage markers reach the auth handoff boundary', () => {
    const recorder: BootstrapDiagnosticRecorder = createBootstrapDiagnosticRecorder(() => Promise.resolve(new Response(null, { status: 204 })))
    expect(recorder.markMainModuleEvaluated()).toBe(true)
    expect(recorder.markHostDetected('max', true, true)).toBe(true)
    expect(recorder.markAuthStarted()).toBe(true)
  })

  test('main marker is the first executable bootstrap statement and auth marker is MAX-only', () => {
    const mainSource = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8')
    const executableLines = mainSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('import '))
    expect(executableLines[0]).toBe('markMainModuleEvaluated()')

    const handoffSource = readFileSync(fileURLToPath(new URL('../src/features/auth/host-auth-handoff.ts', import.meta.url)), 'utf8')
    const markerIndex = handoffSource.indexOf("if (provider === 'max') markAuthStarted()")
    const dispatchIndex = handoffSource.indexOf('void auth.authenticateHost', markerIndex)
    expect(markerIndex).toBeGreaterThanOrEqual(0)
    expect(dispatchIndex).toBeGreaterThan(markerIndex)
  })
})
