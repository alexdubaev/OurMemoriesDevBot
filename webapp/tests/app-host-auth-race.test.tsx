import { expect, test } from 'bun:test'
import { act, createElement, StrictMode, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { AuthContextValue } from '../src/features/auth/context'
import { useHostAuthHandoff } from '../src/features/auth/host-auth-handoff'

type AttemptOptions = Parameters<AuthContextValue['authenticateHost']>[2]

test('superseding a pending MAX payload starts B once and ignores A completion/error', async () => {
  const attempts: Array<{
    payload: string
    options: AttemptOptions | undefined
    deferred: ReturnType<typeof deferred>
  }> = []
  const installedPrincipals: string[] = []
  const snapshots: Array<ReturnType<typeof useHostAuthHandoff>> = []
  let updatePayload!: (payload: string) => void

  function Harness() {
    const [payload, setPayload] = useState('payload-a')
    updatePayload = setPayload
    const auth = {
      isAuthenticated: false,
      isBootstrapping: false,
      authenticateHost: async (_provider: 'max', initData: string, options?: AttemptOptions) => {
        const pending = deferred<void>()
        attempts.push({ payload: initData, options, deferred: pending })
        await pending.promise
        if (options?.signal?.aborted || options?.isCurrent?.() === false) return
        if (initData === 'payload-a') throw new Error('stale A failure')
        installedPrincipals.push(initData)
      },
    }
    const handoff = useHostAuthHandoff({
      auth,
      initData: payload,
      isHostAvailable: true,
      provider: 'max',
    })
    snapshots.push(handoff)
    return null
  }

  const priorWindow = globalThis.window
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, window: { event: undefined, HTMLIFrameElement: class {} } })
  const root = createRoot(detachedContainer())
  await act(async () => {
    root.render(createElement(Harness))
  })
  await flush()
  expect(attempts.map(({ payload }) => payload)).toEqual(['payload-a'])

  await act(async () => updatePayload('payload-b'))
  await flush()
  expect(attempts.map(({ payload }) => payload)).toEqual(['payload-a', 'payload-b'])
  expect(attempts[0]?.options?.signal?.aborted).toBe(true)
  expect(snapshots.at(-1)?.isHostAuthPending).toBe(true)

  await act(async () => {
    attempts[0]?.deferred.resolve()
    await flush()
  })
  expect(snapshots.at(-1)?.hostAuthError).toBeNull()
  expect(snapshots.at(-1)?.isHostAuthPending).toBe(true)
  expect(installedPrincipals).toEqual([])

  await act(async () => {
    attempts[1]?.deferred.resolve()
    await flush()
  })
  expect(attempts).toHaveLength(2)
  expect(installedPrincipals).toEqual(['payload-b'])
  await act(async () => root.unmount())
  Object.assign(globalThis, { window: priorWindow })
})

test('unmounting a pending MAX payload invalidates A before it rejects', async () => {
  const attempts: Array<{
    options: AttemptOptions | undefined
    deferred: ReturnType<typeof deferred>
  }> = []
  const installedPrincipals: string[] = []
  let snapshot: ReturnType<typeof useHostAuthHandoff> | undefined

  function Harness() {
    const [payload] = useState('payload-a')
    const auth = {
      isAuthenticated: false,
      isBootstrapping: false,
      authenticateHost: async (_provider: 'max', initData: string, options?: AttemptOptions) => {
        const pending = deferred<void>()
        attempts.push({ options, deferred: pending })
        await pending.promise
        if (options?.signal?.aborted || options?.isCurrent?.() === false) return
        installedPrincipals.push(initData)
      },
    }
    snapshot = useHostAuthHandoff({
      auth,
      initData: payload,
      isHostAvailable: true,
      provider: 'max',
    })
    return null
  }

  const priorWindow = globalThis.window
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, window: { event: undefined, HTMLIFrameElement: class {} } })
  const root = createRoot(detachedContainer())
  await act(async () => {
    root.render(createElement(Harness))
  })
  await flush()
  expect(attempts).toHaveLength(1)
  expect(snapshot?.isHostAuthPending).toBe(true)

  await act(async () => root.unmount())
  expect(attempts[0]?.options?.signal?.aborted).toBe(true)
  expect(attempts[0]?.options?.isCurrent?.()).toBe(false)

  await act(async () => {
    attempts[0]?.deferred.reject(new Error('stale A failure'))
    await flush()
  })
  expect(installedPrincipals).toEqual([])
  expect(snapshot?.hostAuthError).toBeNull()

  Object.assign(globalThis, { window: priorWindow })
})

test('a committed MAX payload B invalidates A before passive effects and starts B once', async () => {
  const attempts: Array<{
    payload: string
    options: AttemptOptions | undefined
    deferred: ReturnType<typeof deferred>
  }> = []
  const installedPrincipals: string[] = []
  const committedChecks: Array<{ aAborted: boolean | undefined; aCurrent: boolean | undefined; started: string[] }> = []
  let updatePayload!: (payload: string) => void

  function Harness() {
    const [payload, setPayload] = useState('payload-a')
    updatePayload = setPayload
    const auth = {
      isAuthenticated: false,
      isBootstrapping: false,
      authenticateHost: async (_provider: 'max', initData: string, options?: AttemptOptions) => {
        const pending = deferred<void>()
        attempts.push({ payload: initData, options, deferred: pending })
        await pending.promise
        if (options?.signal?.aborted || options?.isCurrent?.() === false) return
        installedPrincipals.push(initData)
      },
    }
    useHostAuthHandoff({
      auth,
      initData: payload,
      isHostAvailable: true,
      provider: 'max',
    })
    useLayoutEffect(() => {
      if (payload !== 'payload-b') return
      committedChecks.push({
        aAborted: attempts[0]?.options?.signal?.aborted,
        aCurrent: attempts[0]?.options?.isCurrent?.(),
        started: attempts.map(({ payload: startedPayload }) => startedPayload),
      })
      attempts[0]?.deferred.resolve()
    }, [payload])
    return null
  }

  const priorWindow = globalThis.window
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, window: { event: undefined, HTMLIFrameElement: class {} } })
  const root = createRoot(detachedContainer())
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Harness)))
  })
  await flush()
  expect(attempts.map(({ payload }) => payload)).toEqual(['payload-a'])

  await act(async () => updatePayload('payload-b'))
  expect(committedChecks).toEqual([{ aAborted: true, aCurrent: false, started: ['payload-a'] }])
  await flush()
  expect(attempts.map(({ payload }) => payload)).toEqual(['payload-a', 'payload-b'])
  await act(async () => {
    attempts[1]?.deferred.resolve()
    await flush()
  })
  expect(installedPrincipals).toEqual(['payload-b'])
  expect(attempts[1]?.options?.signal?.aborted).toBe(false)

  await act(async () => root.unmount())
  Object.assign(globalThis, { window: priorWindow })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flush() {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function detachedContainer() {
  const ownerDocument = {
    nodeType: 9,
    defaultView: { HTMLIFrameElement: class {} },
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  }
  return {
    nodeType: 1,
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Element
}
