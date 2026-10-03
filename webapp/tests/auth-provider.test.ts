import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UserDto } from '@web-app-demo/contracts'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { AuthContextValue } from '../src/features/auth/context'
import { AuthProvider } from '../src/features/auth/provider'
import { useAuth } from '../src/features/auth/use-auth'

type SessionSnapshot = Pick<AuthContextValue, 'isBootstrapping' | 'sessionError' | 'user'>
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; window?: unknown }

const user: UserDto = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: null,
  role: 'user',
  createdAt: '2026-05-11T00:00:00.000Z',
}
const restoredAccessToken = accessTokenFor('user_1')

const originalFetch = globalThis.fetch
const originalWindow = actEnvironment.window
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
const mountedRoots: Root[] = []
const mountedClients: QueryClient[] = []

beforeEach(() => {
  installBrowserShim()
})

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount())
  }
  for (const queryClient of mountedClients.splice(0)) queryClient.clear()
  // Query notifyManager uses a scheduled callback even after its observers unmount. Drain it
  // while the simulated browser globals are still installed, before restoring the test process.
  await act(async () => {
    for (let tick = 0; tick < 3; tick += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  })
  globalThis.fetch = originalFetch
  removeBrowserShim()
})

test('the session stays unknown while the restored access token is still being verified', async () => {
  const me = deferred<Response>()
  const requests = installFakeBackend({
    refresh: () => json({ accessToken: restoredAccessToken }, 200),
    me: () => me.promise,
  })
  const { session, snapshots } = await mountAuthProvider()
  await flushUntil(() => requests.includes('GET /api/v1/auth/me'))

  expect(requests).toContain('GET /api/v1/auth/me')
  expect(session()).toEqual({ isBootstrapping: true, sessionError: null, user: null })

  me.resolve(json({ user }, 200))
  await flushUntil(() => session().user !== null)

  expect(session()).toEqual({ isBootstrapping: false, sessionError: null, user })
  const signedOutRenders = snapshots.filter(
    (snapshot) => !snapshot.isBootstrapping && !snapshot.sessionError && !snapshot.user,
  )
  expect(signedOutRenders).toEqual([])
})

test('a browser without a session cookie resolves to signed out without loading /me', async () => {
  const requests = installFakeBackend({
    refresh: () => json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'No session',
        requestId: '01993b24-7e7d-7000-8000-000000000204',
      },
    }, 401),
    me: () => json({ user }, 200),
  })
  const { session } = await mountAuthProvider()
  await flushUntil(() => !session().isBootstrapping)

  expect(session()).toEqual({ isBootstrapping: false, sessionError: null, user: null })
  expect(requests).not.toContain('GET /api/v1/auth/me')
})

test('a failed session restore surfaces the error instead of an unknown session', async () => {
  const requests = installFakeBackend({
    refresh: () => json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Refresh failed',
        requestId: '01993b24-7e7d-7000-8000-000000000205',
      },
    }, 500),
    me: () => json({ user }, 200),
  })
  const { session } = await mountAuthProvider()
  await flushUntil(() => !session().isBootstrapping)

  expect(session().isBootstrapping).toBe(false)
  expect(session().user).toBeNull()
  expect(session().sessionError?.message).toBe('Refresh failed')
  expect(requests).not.toContain('GET /api/v1/auth/me')
})

test('verified MAX authentication clears an obsolete cookie bootstrap error', async () => {
  installFakeBackend({
    refresh: () => json({ error: { code: 'INTERNAL_ERROR', message: 'Refresh failed', requestId: '01993b24-7e7d-7000-8000-000000000205' } }, 500),
    me: () => json({ user }, 200),
    max: () => json({ accessToken: restoredAccessToken, user }, 200),
  })
  const mounted = await mountAuthProvider()
  await flushUntil(() => !mounted.session().isBootstrapping)
  expect(mounted.session().sessionError?.message).toBe('Refresh failed')

  await act(async () => { await mounted.authenticateMax('synthetic-init-data') })
  await flushUntil(() => mounted.session().sessionError === null)
  expect(mounted.session()).toEqual({ isBootstrapping: false, sessionError: null, user })
})

async function mountAuthProvider() {
  const snapshots: SessionSnapshot[] = []
  let currentAuth: AuthContextValue | null = null
  function SessionProbe() {
    const auth = useAuth()
    currentAuth = auth
    snapshots.push({
      isBootstrapping: auth.isBootstrapping,
      sessionError: auth.sessionError,
      user: auth.user,
    })
    return null
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mountedClients.push(queryClient)
  const root = createRoot(createDetachedContainer())
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AuthProvider, null, createElement(SessionProbe)),
      ),
    )
  })

  return {
    snapshots,
    authenticateMax: async (payload: string) => {
      if (!currentAuth) throw new Error('AuthProvider has not rendered its consumer yet')
      await currentAuth.authenticateMax(payload)
    },
    session: () => {
      const latest = snapshots[snapshots.length - 1]
      if (!latest) throw new Error('AuthProvider has not rendered its consumer yet')
      return latest
    },
  }
}

// TanStack Query delivers query results to React on a zero-delay timer, so the tests advance in
// act-wrapped timer ticks until the observed state arrives instead of guessing a fixed delay.
async function flushUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }
}

function installFakeBackend(backend: {
  refresh: () => Response | Promise<Response>
  me: () => Response | Promise<Response>
  max?: () => Response | Promise<Response>
}) {
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), 'https://webapp.test').pathname
    requests.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/v1/auth/refresh') return backend.refresh()
    if (path === '/api/v1/auth/me') return backend.me()
    if (path === '/api/v1/auth/max' && backend.max) return backend.max()
    return json({ error: { code: 'NOT_FOUND', message: 'Unexpected request' } }, 404)
  }
  return requests
}

// The repository has no DOM library and the provider renders no host elements, so a plain object
// with the members React DOM touches for a root container (event delegation and focus lookup) is
// enough to run the provider's effects under `act`.
const browserShim = {
  event: undefined,
  document: { activeElement: null, body: null },
  HTMLIFrameElement: class {},
  addEventListener() {},
  removeEventListener() {},
}
function installBrowserShim() {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  actEnvironment.window = browserShim
}

function removeBrowserShim() {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  if (originalWindow === undefined) delete actEnvironment.window
  else actEnvironment.window = originalWindow
}

function createDetachedContainer() {
  const ownerDocument = {
    nodeType: 9,
    defaultView: browserShim,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function accessTokenFor(subject: string) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: subject })}.signature`
}
