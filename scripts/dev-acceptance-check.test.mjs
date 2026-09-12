import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

import { assertDevRuntimeProcesses, inspectDevRuntimeProcesses } from './dev-runtime-processes.mjs'

const apiWatchTree = [
  { processId: 10, parentProcessId: 1, commandLine: 'bun --watch src/index.ts' },
  { processId: 11, parentProcessId: 10, commandLine: 'bun src/index.ts' },
]

const schedulerWatchTree = [
  { processId: 20, parentProcessId: 1, commandLine: 'bun --watch src/scheduler.ts' },
  { processId: 21, parentProcessId: 20, commandLine: 'bun src/scheduler.ts' },
]

test('accepts one direct API runtime process owning the expected port', () => {
  expect(() => assertDevRuntimeProcesses({
    processes: [
      { processId: 5, parentProcessId: 1, commandLine: 'bun src/index.ts' },
      { processId: 6, parentProcessId: 1, commandLine: 'bun src/scheduler.ts' },
    ],
    apiListenerProcessIds: [5],
    viteProcessCount: 1,
  })).not.toThrow()
})

test('accepts one API watch tree whose leaf owns the expected port', () => {
  const snapshot = {
    processes: [...apiWatchTree, ...schedulerWatchTree],
    apiListenerProcessIds: [11],
    viteProcessCount: 1,
  }
  expect(inspectDevRuntimeProcesses(snapshot)).toMatchObject({ apiRootProcessIds: [10], apiListenerBelongsToApiTree: true })
  expect(() => assertDevRuntimeProcesses(snapshot)).not.toThrow()
})

test('rejects two independent API trees even when only one leaf binds the port', () => {
  const snapshot = {
    processes: [...apiWatchTree, ...schedulerWatchTree, { processId: 30, parentProcessId: 1, commandLine: 'bun --watch src/index.ts' }],
    apiListenerProcessIds: [11],
    viteProcessCount: 1,
  }
  expect(inspectDevRuntimeProcesses(snapshot).apiRootProcessIds).toEqual([10, 30])
  expect(() => assertDevRuntimeProcesses(snapshot)).toThrow('API logical process tree count is 2')
})

test('recognizes one scheduler watch parent and child as one logical scheduler', () => {
  const snapshot = { processes: [...apiWatchTree, ...schedulerWatchTree], apiListenerProcessIds: [11], viteProcessCount: 1 }
  expect(inspectDevRuntimeProcesses(snapshot).schedulerRootProcessIds).toEqual([20])
  expect(() => assertDevRuntimeProcesses(snapshot)).not.toThrow()
})

test('rejects two independent scheduler roots', () => {
  const snapshot = {
    processes: [...apiWatchTree, ...schedulerWatchTree, { processId: 40, parentProcessId: 1, commandLine: 'bun --watch src/scheduler.ts' }],
    apiListenerProcessIds: [11],
    viteProcessCount: 1,
  }
  expect(inspectDevRuntimeProcesses(snapshot).schedulerRootProcessIds).toEqual([20, 40])
  expect(() => assertDevRuntimeProcesses(snapshot)).toThrow('scheduler logical process tree count is 2')
})

test('reports a missing API listener', () => {
  const snapshot = { processes: apiWatchTree, apiListenerProcessIds: [], viteProcessCount: 1 }
  expect(inspectDevRuntimeProcesses(snapshot).apiListenerBelongsToApiTree).toBe(false)
  expect(() => assertDevRuntimeProcesses(snapshot)).toThrow('API port 3000 listener count is 0')
})

test('reports an API listener that is outside the API process tree', () => {
  const snapshot = {
    processes: [...apiWatchTree, { processId: 99, parentProcessId: 1, commandLine: 'other-project runtime' }],
    apiListenerProcessIds: [99],
    viteProcessCount: 1,
  }
  expect(inspectDevRuntimeProcesses(snapshot).apiListenerBelongsToApiTree).toBe(false)
  expect(() => assertDevRuntimeProcesses(snapshot)).toThrow('API port 3000 listener does not belong')
})

test('fails closed when the local API is unavailable', () => {
  const result = spawnSync('bun', ['scripts/dev-acceptance-check.mjs'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, ACCEPTANCE_API_URL: 'http://127.0.0.1:1' },
    encoding: 'utf8',
  })

  expect(result.status).toBe(1)
  expect(`${result.stdout}${result.stderr}`).toContain('API unavailable')
})

test('keeps a non-zero API stability window in the default acceptance gate', async () => {
  const source = await Bun.file(resolve(import.meta.dirname, 'dev-acceptance-check.mjs')).text()

  expect(source).toContain("ACCEPTANCE_STABILITY_MS ?? '15000'")
  expect(source).toContain("await requireResponse('API after stability window'")
})
