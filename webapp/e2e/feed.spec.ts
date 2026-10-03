import type { Page } from '@playwright/test'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createPrisma } from '../../backend/src/db'
import { FilesystemPrivateStorage } from '../../backend/src/storage/filesystem-storage'
import { pngImage } from './helpers/images'
import { expect, test } from './helpers/test'

type E2EAttachment = {
  id?: string
  source?: string
  kind?: string
  width?: number | null
  height?: number | null
  [key: string]: unknown
}

type E2EMemoryFixture = {
  familyId: string
  body?: string
  attachments: E2EAttachment[]
  [key: string]: unknown
}

const subject = '81000013'
const databaseUrl = process.env.TEST_DATABASE_URL!
const backendUrl = process.env.E2E_BACKEND_URL!
const storageRoot = resolve('e2e/.artifacts/storage')
const prisma = createPrisma(databaseUrl)
const storage = new FilesystemPrivateStorage({
  driver: 'filesystem',
  root: storageRoot,
  publicBaseUrl: backendUrl,
  signingKey: Buffer.alloc(32, 1),
  uploadMaxBytes: 100_000_000,
  uploadUrlTtlSeconds: 300,
  downloadUrlTtlSeconds: 300,
})

let fixture: Awaited<ReturnType<typeof seedFeed>>

test.describe.serial('T07 live feed', () => {
  test.beforeAll(async () => {
    fixture = await seedFeed()
  })

  test.afterAll(async () => {
    if (!fixture) {
      await prisma.$disconnect()
      return
    }
    await prisma.telegramVideoDelivery.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramVideoReference.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramSource.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramInbox.deleteMany({ where: { botId: fixture.botId } })
    await prisma.memoryLike.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.family.delete({ where: { id: fixture.familyId } })
    await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
    await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.ownerUserId } })
    await Promise.all(fixture.objectKeys.map((key) => storage.deleteObject(key)))
    await prisma.$disconnect()
  })

  test.beforeEach(async ({ page }, testInfo) => {
    const initData = signedInitData(Number(subject), 'Лента E2E')
    const responsiveWidth = testInfo.title.match(/feed is usable at (\d+)px$/)?.[1]
    if (testInfo.title === 'renders intrinsic photo and MAX video ratios and opens the memoLy bot' || testInfo.title.startsWith('MAX reaction haptic') || testInfo.title.startsWith('MAX poster lifecycle')) {
      await installMaxHost(page, initData)
      await installMaxAuthRoute(page)
    } else {
      await installTelegramHost(page, initData, responsiveWidth ? { bottom: 18, top: 24 } : undefined)
    }
    if (responsiveWidth) await page.setViewportSize({ width: Number(responsiveWidth), height: 844 })
    if (testInfo.title === 'closes access and pauses playback after membership revoke') {
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 0n } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
      })
    }
    await page.goto('/')
    if (testInfo.title.startsWith('restores the authenticated family presentation') ||
        testInfo.title === 'renders intrinsic photo and MAX video ratios and opens the memoLy bot' ||
        testInfo.title.startsWith('MAX poster lifecycle') ||
        testInfo.title === 'streams voice and legacy video on demand after legacy metadata, seeks with Range/206, and pauses on hide') {
      const continueButton = page.getByRole('button', { name: 'Продолжить' })
      await expect(continueButton).toBeVisible()
      await continueButton.click()
    }
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  })

  test('restores the authenticated family presentation from IndexedDB after a page restart', async ({ page }) => {
    await openFeed(page)
    await expect.poll(() => page.evaluate(async (expectedFamilyId: string) => {
      const request = indexedDB.open('memoly-private-cache')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
      const count = await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction('entries', 'readonly')
        const cursor = transaction.objectStore('entries').openCursor()
        let found = false
        cursor.onsuccess = () => {
          const current = cursor.result
          if (!current) return resolve(found ? 1 : 0)
          const value = current.value as { kind?: string; data?: { queries?: Array<{ queryKey?: unknown[]; data?: { screen?: string; selectedFamilyId?: string | null } }> } }
          found ||= value.kind === 'queries' && Boolean(value.data?.queries?.some((query) =>
            query.queryKey?.[1] === 'persistent-ui' && query.data?.screen === 'feed' && query.data.selectedFamilyId === expectedFamilyId))
          current.continue()
        }
        cursor.onerror = () => reject(cursor.error)
      })
      db.close()
      return count
    }, fixture.familyId)).toBe(1)
    const savedPresentation = await page.evaluate(async (userId) => {
      const request = indexedDB.open('memoly-private-cache')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const value = await new Promise<{ screen?: string; selectedFamilyId?: string | null } | null>((resolve, reject) => {
        const request = db.transaction('entries', 'readonly').objectStore('entries').get(`memoLy:1:${userId}:queries:state`)
        request.onsuccess = () => {
          const entry = request.result as { data?: { queries?: Array<{ queryKey: unknown[]; data: { screen?: string; selectedFamilyId?: string | null } }> } } | undefined
          resolve(entry?.data?.queries?.find((query) => query.queryKey[1] === 'persistent-ui')?.data ?? null)
        }
        request.onerror = () => reject(request.error)
      })
      db.close()
      return value
    }, fixture.userId)
    if (savedPresentation?.screen !== 'feed' || savedPresentation.selectedFamilyId !== fixture.familyId) {
      throw new Error(JSON.stringify({ savedPresentation, visibleText: await page.locator('body').innerText() }))
    }
    let releaseFamilyHome!: () => void
    let markFamilyHomeStarted!: () => void
    const familyHomeHold = new Promise<void>((resolve) => { releaseFamilyHome = resolve })
    const familyHomeStarted = new Promise<void>((resolve) => { markFamilyHomeStarted = resolve })
    let releaseFamilyDetail!: () => void
    let markFamilyDetailStarted!: () => void
    const familyDetailHold = new Promise<void>((resolve) => { releaseFamilyDetail = resolve })
    const familyDetailStarted = new Promise<void>((resolve) => { markFamilyDetailStarted = resolve })
    await page.route('**/api/v1/me/families*', async (route) => {
      markFamilyHomeStarted()
      await familyHomeHold
      await route.continue()
    })
    await page.route(`**/api/v1/families/${fixture.familyId}`, async (route) => {
      markFamilyDetailStarted()
      await familyDetailHold
      const response = await route.fetch()
      const payload = await response.json() as { child: { name: string } }
      payload.child.name = 'Обновлено E2E'
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.reload()
    const welcomeContinue = page.getByRole('button', { name: 'Продолжить' })
    await expect(welcomeContinue).toBeVisible()
    await welcomeContinue.click()
    await familyHomeStarted
    await expect(page.getByRole('heading', { name: 'Лента воспоминаний' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toHaveCount(0)
    await page.screenshot({ path: resolve('e2e/.artifacts/persistent-cache-restored-feed.png'), animations: 'disabled' })
    releaseFamilyHome()
    await familyDetailStarted
    await expect(page.getByRole('heading', { name: 'Лента воспоминаний' })).toBeVisible()
    await expect(page.getByText('Лиза', { exact: true })).toBeVisible()
    releaseFamilyDetail()
    await expect(page.getByText('Обновлено E2E')).toBeVisible()
    await page.unroute('**/api/v1/me/families*')
    await page.unroute(`**/api/v1/families/${fixture.familyId}`)

    const otherFamilyId = randomUUID()
    const cleanup = await page.evaluate(async ({ userId, familyId, otherFamilyId, imageBase64 }) => {
      const cache = await import('/src/platform/persistence/private-cache.ts')
      const { QueryClient } = await import('/node_modules/.vite/deps/@tanstack_react-query.js')
      const restoredForA = new QueryClient()
      const userAGenerationForQueries = cache.activatePrivateCacheIdentity(userId)
      await cache.restorePrivateQueryCache(restoredForA, userId, userAGenerationForQueries)
      const restoredPresentation = restoredForA.getQueryData<{ screen?: string; selectedFamilyId?: string | null }>(cache.persistentUiQueryKey(userId))
      const restoredFeedCount = restoredForA.getQueryCache().getAll().filter((query) => query.queryKey[1] === 'feed').length
      const isolatedUserId = `${userId}-other-account`
      const restoredForB = new QueryClient()
      const userBGenerationForQueries = cache.activatePrivateCacheIdentity(isolatedUserId)
      await cache.restorePrivateQueryCache(restoredForB, isolatedUserId, userBGenerationForQueries)
      const otherUserQueries = restoredForB.getQueryCache().getAll().length
      const sourceFeedData = restoredForA.getQueryCache().getAll().find((query) => query.queryKey[1] === 'feed')?.state.data
      const boundedUserId = `${userId}-bounded`
      const boundedClient = new QueryClient()
      boundedClient.setQueryData(cache.persistentUiQueryKey(boundedUserId), restoredPresentation)
      for (let i = 0; i < 120; i++) {
        boundedClient.setQueryData(['session', 'feed', familyId, 'all', false, null, null, { page: i }], { pages: [{ items: [], nextCursor: null }], pageParams: [null] }, { updatedAt: i })
      }
      const boundedGeneration = cache.activatePrivateCacheIdentity(boundedUserId)
      await cache.persistPrivateQueryCache(boundedClient, boundedUserId, boundedGeneration)
      const boundDbRequest = indexedDB.open('memoly-private-cache')
      const boundDb = await new Promise<IDBDatabase>((resolve, reject) => { boundDbRequest.onsuccess = () => resolve(boundDbRequest.result); boundDbRequest.onerror = () => reject(boundDbRequest.error) })
      const boundedSnapshot = await new Promise<{ queries: Array<{ queryKey: unknown[] }> } | null>((resolve, reject) => {
        const request = boundDb.transaction('entries', 'readonly').objectStore('entries').get(`memoLy:1:${boundedUserId}:queries:state`)
        request.onsuccess = () => resolve((request.result as { data?: { queries?: Array<{ queryKey: unknown[] }> } } | undefined)?.data as { queries: Array<{ queryKey: unknown[] }> } | undefined ?? null)
        request.onerror = () => reject(request.error)
      })
      boundDb.close()
      const boundedQueryCount = boundedSnapshot?.queries.length ?? 0
      const boundedByteSize = new TextEncoder().encode(JSON.stringify(boundedSnapshot)).byteLength
      const keptPresentation = boundedSnapshot?.queries.some((query) => query.queryKey[1] === 'persistent-ui') ?? false
      const byteBoundedUserId = `${userId}-byte-bounded`
      const byteBoundedClient = new QueryClient()
      byteBoundedClient.setQueryData(cache.persistentUiQueryKey(byteBoundedUserId), restoredPresentation)
      const largeFeedData = structuredClone(sourceFeedData) as { pages: Array<{ items: Array<{ body: string }> }>; pageParams: unknown[] } | undefined
      if (largeFeedData?.pages[0]?.items[0]) largeFeedData.pages[0].items[0].body = 'x'.repeat(30_000)
      for (let i = 0; i < 120; i++) byteBoundedClient.setQueryData(['session', 'feed', familyId, 'all', false, null, null, { page: i }], largeFeedData, { updatedAt: i })
      const byteBoundedGeneration = cache.activatePrivateCacheIdentity(byteBoundedUserId)
      await cache.persistPrivateQueryCache(byteBoundedClient, byteBoundedUserId, byteBoundedGeneration)
      const byteBoundedDbRequest = indexedDB.open('memoly-private-cache')
      const byteBoundedDb = await new Promise<IDBDatabase>((resolve, reject) => { byteBoundedDbRequest.onsuccess = () => resolve(byteBoundedDbRequest.result); byteBoundedDbRequest.onerror = () => reject(byteBoundedDbRequest.error) })
      const byteBoundedSnapshot = await new Promise<{ queries: Array<{ queryKey: unknown[] }> } | null>((resolve, reject) => {
        const request = byteBoundedDb.transaction('entries', 'readonly').objectStore('entries').get(`memoLy:1:${byteBoundedUserId}:queries:state`)
        request.onsuccess = () => resolve((request.result as { data?: { queries?: Array<{ queryKey: unknown[] }> } } | undefined)?.data as { queries: Array<{ queryKey: unknown[] }> } | undefined ?? null)
        request.onerror = () => reject(request.error)
      })
      byteBoundedDb.close()
      const byteBoundedSize = new TextEncoder().encode(JSON.stringify(byteBoundedSnapshot)).byteLength
      const byteBoundedPresentationKept = byteBoundedSnapshot?.queries.some((query) => query.queryKey[1] === 'persistent-ui') ?? false
      const generation = cache.activatePrivateCacheIdentity(userId)
      cache.allowPrivateFamilyCache(userId, familyId)
      cache.allowPrivateFamilyCache(userId, otherFamilyId)
      const bytes = Uint8Array.from(atob(imageBase64), (char) => char.charCodeAt(0))
      const familyPath = `/api/v1/families/${familyId}/media/11111111-1111-4111-8111-111111111111/content?variant=display`
      const otherPath = `/api/v1/families/${otherFamilyId}/media/22222222-2222-4222-8222-222222222222/content?variant=display`
      await cache.cachePrivateImageResponse(userId, familyPath, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), generation)
      await cache.cachePrivateImageResponse(userId, otherPath, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), generation)
      const avatarUserId = crypto.randomUUID()
      const avatarPath = `/api/v1/families/${familyId}/media/avatars/${avatarUserId}/${crypto.randomUUID()}/content`
      const changedAvatarPath = `/api/v1/families/${familyId}/media/avatars/${avatarUserId}/${crypto.randomUUID()}/content`
      const posterPath = `/api/v1/families/${familyId}/media/max-videos/${crypto.randomUUID()}/poster`
      const avatarStored = await cache.cachePrivateImageResponse(userId, avatarPath, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), generation)
      const posterStored = await cache.cachePrivateImageResponse(userId, posterPath, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), generation)
      const rejectedVideo = await cache.cachePrivateImageResponse(userId, `/api/v1/families/${familyId}/media/max-videos/${crypto.randomUUID()}/content`, new Response(bytes, { headers: { 'Content-Type': 'video/mp4' } }), generation)
      const rejectedPartial = await cache.cachePrivateImageResponse(userId, familyPath, new Response(bytes, { status: 206, headers: { 'Content-Type': 'image/png' } }), generation)
      const changedAvatarMiss = await cache.readPrivateImage(userId, changedAvatarPath)
      const avatarHit = avatarStored && (await cache.readPrivateImage(userId, avatarPath))?.size === bytes.length
      const posterHit = posterStored && (await cache.readPrivateImage(userId, posterPath))?.size === bytes.length
      const queryClient = { removeQueries() {}, setQueryData() {}, getQueryCache: () => ({ getAll: () => [] }) }
      await cache.removePrivateFamilyCache(queryClient as never, userId, familyId)
      const removed = await cache.readPrivateImage(userId, familyPath)
      const retained = await cache.readPrivateImage(userId, otherPath)
      await cache.clearPrivateUserCache(userId)
      const afterLogout = await cache.readPrivateImage(userId, otherPath)
      const isolatedUserA = `${userId}-cache-a`
      const isolatedUserB = `${userId}-cache-b`
      const isolatedPath = `/api/v1/families/${familyId}/media/33333333-3333-4333-8333-333333333333/content?variant=display`
      const blueBytes = Uint8Array.from([0, 1, 2, 255])
      const userAGeneration = cache.activatePrivateCacheIdentity(isolatedUserA)
      cache.allowPrivateFamilyCache(isolatedUserA, familyId)
      await cache.cachePrivateImageResponse(isolatedUserA, isolatedPath, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), userAGeneration)
      const userBGeneration = cache.activatePrivateCacheIdentity(isolatedUserB)
      cache.allowPrivateFamilyCache(isolatedUserB, familyId)
      await cache.cachePrivateImageResponse(isolatedUserB, isolatedPath, new Response(blueBytes, { headers: { 'Content-Type': 'image/png' } }), userBGeneration)
      const userAImage = await cache.readPrivateImage(isolatedUserA, isolatedPath)
      const userBImage = await cache.readPrivateImage(isolatedUserB, isolatedPath)
      const lateGeneration = cache.activatePrivateCacheIdentity(isolatedUserA)
      cache.allowPrivateFamilyCache(isolatedUserA, familyId)
      const lateFamilyGeneration = cache.privateFamilyCacheGeneration(isolatedUserA, familyId)
      cache.activatePrivateCacheIdentity(isolatedUserB)
      const lateWrite = await cache.cachePrivateImageResponse(isolatedUserA, isolatedPath, new Response(blueBytes, { headers: { 'Content-Type': 'image/png' } }), lateGeneration, lateFamilyGeneration)

      const malformedUser = `${userId}-old-schema`
      const dbRequest = indexedDB.open('memoly-private-cache')
      const db = await new Promise<IDBDatabase>((resolve, reject) => { dbRequest.onsuccess = () => resolve(dbRequest.result); dbRequest.onerror = () => reject(dbRequest.error) })
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('entries', 'readwrite')
        transaction.objectStore('entries').put({ id: `memoLy:1:${malformedUser}:image:old`, userId: malformedUser, schema: 0, kind: 'image', key: 'old', size: 1, lastAccess: Date.now(), blob: new Blob([bytes]) })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
      cache.activatePrivateCacheIdentity(malformedUser)
      const malformedGeneration = cache.privateCacheIdentityGeneration()
      await cache.restorePrivateQueryCache({ removeQueries() {}, setQueryData() {}, getQueryCache: () => ({ getAll: () => [] }) } as never, malformedUser, malformedGeneration)
      const staleDbRequest = indexedDB.open('memoly-private-cache')
      const staleDb = await new Promise<IDBDatabase>((resolve, reject) => { staleDbRequest.onsuccess = () => resolve(staleDbRequest.result); staleDbRequest.onerror = () => reject(staleDbRequest.error) })
      const staleSchema = await new Promise<unknown>((resolve, reject) => {
        const request = staleDb.transaction('entries', 'readonly').objectStore('entries').get(`memoLy:1:${malformedUser}:image:old`)
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
      staleDb.close()

      const evictionUser = `${userId}-eviction`
      const evictionGeneration = cache.activatePrivateCacheIdentity(evictionUser)
      cache.allowPrivateFamilyCache(evictionUser, familyId)
      const paths = Array.from({ length: 101 }, (_, i) => `/api/v1/families/${familyId}/media/${`${i}`.padStart(8, '0')}-1111-4111-8111-111111111111/content?variant=display`)
      for (const path of paths) await cache.cachePrivateImageResponse(evictionUser, path, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), evictionGeneration)
      const evictionDbRequest = indexedDB.open('memoly-private-cache')
      const evictionDb = await new Promise<IDBDatabase>((resolve, reject) => { evictionDbRequest.onsuccess = () => resolve(evictionDbRequest.result); evictionDbRequest.onerror = () => reject(evictionDbRequest.error) })
      const evictionCount = await new Promise<number>((resolve, reject) => {
        let count = 0
        const request = evictionDb.transaction('entries', 'readonly').objectStore('entries').index('userId').openCursor(IDBKeyRange.only(evictionUser))
        request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(count); if ((cursor.value as { kind?: string }).kind === 'image') count++; cursor.continue() }
        request.onerror = () => reject(request.error)
      })
      evictionDb.close()
      const ageDbRequest = indexedDB.open('memoly-private-cache')
      const ageDb = await new Promise<IDBDatabase>((resolve, reject) => { ageDbRequest.onsuccess = () => resolve(ageDbRequest.result); ageDbRequest.onerror = () => reject(ageDbRequest.error) })
      await new Promise<void>((resolve, reject) => {
        const transaction = ageDb.transaction('entries', 'readwrite')
        const request = transaction.objectStore('entries').index('userId').openCursor(IDBKeyRange.only(evictionUser))
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          const entry = cursor.value as { kind?: string; key?: string; lastAccess?: number }
          if (entry.kind === 'image' && entry.key === paths[100]) cursor.update({ ...cursor.value, lastAccess: Date.now() - 31 * 24 * 60 * 60 * 1000 })
          cursor.continue()
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      ageDb.close()
      cache.activatePrivateCacheIdentity(evictionUser)
      const agedImage = await cache.readPrivateImage(evictionUser, paths[100]!)
      return {
        familyRemoved: removed === null,
        otherFamilyRetained: retained?.size === bytes.length,
        avatarImageHit: avatarHit,
        posterImageHit: posterHit,
        changedAvatarIdMiss: changedAvatarMiss === null,
        rejectsVideoAndPartial: rejectedVideo === false && rejectedPartial === false,
        logoutCleared: afterLogout === null,
        usersIsolated: userAImage?.size === bytes.length && userBImage?.size === blueBytes.length,
        lateWriteRejected: lateWrite === false,
        staleSchemaDiscarded: staleSchema === null,
        imageEvictionBounded: evictionCount <= 100,
        expiredImagePruned: agedImage === null,
        queryRestoreForOwner: restoredPresentation?.screen === 'feed' && restoredPresentation.selectedFamilyId === familyId && restoredFeedCount > 0,
        queryIsolationForOtherUser: otherUserQueries === 0,
        queryCountBounded: boundedQueryCount <= 100 && keptPresentation,
        queryBytesBounded: byteBoundedSize <= 2 * 1024 * 1024 && byteBoundedPresentationKept,
        querySnapshotBytesBounded: boundedByteSize <= 2 * 1024 * 1024,
      }
    }, { userId: fixture.userId, familyId: fixture.familyId, otherFamilyId, imageBase64: pngImage.buffer.toString('base64') })
    expect(cleanup).toEqual({ familyRemoved: true, otherFamilyRetained: true, avatarImageHit: true, posterImageHit: true, changedAvatarIdMiss: true, rejectsVideoAndPartial: true, logoutCleared: true, usersIsolated: true, lateWriteRejected: true, staleSchemaDiscarded: true, imageEvictionBounded: true, expiredImagePruned: true, queryRestoreForOwner: true, queryIsolationForOtherUser: true, queryCountBounded: true, queryBytesBounded: true, querySnapshotBytesBounded: true })
    await page.evaluate(async ({ userId, familyId }) => {
      const cache = await import('/src/platform/persistence/private-cache.ts')
      cache.activatePrivateCacheIdentity(userId)
      window.dispatchEvent(new CustomEvent(cache.privateFamilyAccessRevokedEvent, { detail: { userId, familyId } }))
    }, { userId: fixture.userId, familyId: fixture.familyId })
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Лента воспоминаний' })).toHaveCount(0)
  })

  test('unread action and exit stay compact, keyboard accessible, and empty when appropriate', async ({ page }) => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId }, select: { unreadTrackingActivatedAt: true, publicationOrdinal: true } })
    const member = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, select: { unreadBaselineOrdinal: true, membershipEpoch: true } })
    const baseline = family.publicationOrdinal
    const ids = Array.from({ length: 3 }, () => randomUUID())
    const now = Date.now() - 86_400_000
    try {
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: baseline } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: baseline } })
      })
      await page.reload()
      await page.locator('[data-slot="family-hub"] .family-hub-card').click()
      await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
      await expect(page.locator('.feed-unread-action, .feed-unread-mode')).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.locator('[data-slot="date-heading"]').first()).toBeVisible()
      await expect(page.locator('[data-memory-id]').first()).toBeVisible()
      const emptyGeometry = await page.evaluate(() => {
        const header = document.querySelector('[data-child-header-mode="feed"]')
        const date = document.querySelector('[data-slot="date-heading"]')
        return header && date ? { gap: date.getBoundingClientRect().top - header.getBoundingClientRect().bottom, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth } : null
      })
      expect(emptyGeometry).not.toBeNull()
      expect(emptyGeometry!.gap).toBeGreaterThanOrEqual(0)
      expect(emptyGeometry!.gap).toBeLessThan(32)
      expect(emptyGeometry!.scrollWidth).toBeLessThanOrEqual(emptyGeometry!.clientWidth)
      await page.screenshot({ path: resolve('e2e/.artifacts/feed-unread-390-zero.png'), animations: 'disabled' })
      for (const width of [320, 430]) {
        await page.setViewportSize({ width, height: 844 })
        await expect(page.locator('.feed-unread-action, .feed-unread-mode')).toHaveCount(0)
        const scroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
        expect(scroll.width).toBeLessThanOrEqual(scroll.clientWidth)
        await page.screenshot({ path: resolve(`e2e/.artifacts/feed-unread-${width}-zero.png`), animations: 'disabled' })
      }

      await prisma.$transaction(async (tx) => {
        for (const [index, id] of ids.entries()) {
          await tx.family.update({ where: { id: fixture.familyId }, data: { publicationOrdinal: baseline + BigInt(index + 1) } })
          await tx.memory.create({ data: {
            id, familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
            kind: 'note', body: `Новая синтетическая заметка ${index + 1}\n${'Текст ниже первого экрана. '.repeat(24)}`,
            occurredAt: new Date(now - index * 60_000), firstPublishedAt: new Date(), firstPublishedOrdinal: baseline + BigInt(index + 1),
          } })
        }
      })
      await page.reload()
      await page.locator('[data-slot="family-hub"] .family-hub-card').click()
      const action = page.locator('.feed-unread-action')
      await expect(action).toHaveText('3 новых')
      await expect(action).toHaveAttribute('aria-label', 'Показать 3 непросмотренных воспоминания')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: resolve('e2e/.artifacts/feed-unread-390-three.png'), animations: 'disabled' })

      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 })
        const metrics = await action.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return { width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, whiteSpace: style.whiteSpace }
        })
        expect(metrics.width).toBeGreaterThanOrEqual(44)
        expect(metrics.height).toBeGreaterThanOrEqual(44)
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
        expect(metrics.whiteSpace).toBe('nowrap')
        await page.screenshot({ path: resolve(`e2e/.artifacts/feed-unread-${width}-three.png`), animations: 'disabled' })
      }

      const themeTextTokens: Record<string, string> = { mint: '#6f7f78', rose: '#876f72', sky: '#6b7f89', lavender: '#7b7488', apricot: '#8a766a', sand: '#777a69' }
      for (const theme of Object.keys(themeTextTokens)) {
        const metrics = await action.evaluate((element, name) => {
          document.documentElement.setAttribute('data-memoly-theme', String(name))
          document.querySelector('.memoly-app-root')?.setAttribute('data-memoly-theme', String(name))
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          const rootStyle = getComputedStyle(document.documentElement)
          return { width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, color: style.color, themeText: rootStyle.getPropertyValue('--theme-text-muted').trim(), canvasTop: rootStyle.getPropertyValue('--theme-canvas-top').trim(), canvasBottom: rootStyle.getPropertyValue('--theme-canvas-bottom').trim(), background: style.backgroundImage, shadow: style.boxShadow }
        }, theme)
        expect(metrics.width).toBeGreaterThanOrEqual(44)
        expect(metrics.height).toBeGreaterThanOrEqual(44)
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
        expect(metrics.color).toBe('rgb(48, 42, 46)')
        expect(metrics.themeText).toBe(themeTextTokens[theme])
        expect(metrics.background).toBe('none')
        expect(metrics.shadow).toBe('none')
        expect(contrastRatio(metrics.color, metrics.canvasTop)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(metrics.color, metrics.canvasBottom)).toBeGreaterThanOrEqual(4.5)
      }
      await page.evaluate(() => { document.documentElement.setAttribute('data-memoly-theme', 'mint'); document.querySelector('.memoly-app-root')?.setAttribute('data-memoly-theme', 'mint') })
      await page.setViewportSize({ width: 390, height: 844 })
      await action.focus()
      await page.keyboard.press('Enter')
      const mode = page.locator('.feed-unread-mode')
      await expect(mode.locator('.feed-unread-label').first()).toHaveText('Непросмотренные · 3')
      const exit = page.getByRole('button', { name: 'Выйти из режима непросмотренных' })
      const exitSize = await exit.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
      expect(exitSize.width).toBeGreaterThanOrEqual(44)
      expect(exitSize.height).toBeGreaterThanOrEqual(44)
      await exit.focus()
      const focus = await exit.evaluate((element) => ({ width: getComputedStyle(element).outlineWidth, color: getComputedStyle(element).outlineColor, top: getComputedStyle(document.documentElement).getPropertyValue('--theme-canvas-top').trim(), bottom: getComputedStyle(document.documentElement).getPropertyValue('--theme-canvas-bottom').trim() }))
      expect(focus.width).toBe('2px')
      expect(contrastRatio(focus.color, focus.top)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(focus.color, focus.bottom)).toBeGreaterThanOrEqual(3)
      await page.screenshot({ path: resolve('e2e/.artifacts/feed-unread-390-mode.png'), animations: 'disabled' })
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 })
        const metrics = await mode.evaluate((element) => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, whiteSpace: getComputedStyle(element.querySelector('.feed-unread-label')!).whiteSpace, exit: element.querySelector('button')!.getBoundingClientRect().toJSON() }))
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
        expect(metrics.whiteSpace).toBe('nowrap')
        expect(metrics.exit.width).toBeGreaterThanOrEqual(44)
        expect(metrics.exit.height).toBeGreaterThanOrEqual(44)
        await page.screenshot({ path: resolve(`e2e/.artifacts/feed-unread-${width}-mode.png`), animations: 'disabled' })
      }
      for (const [theme, expectedToken] of Object.entries(themeTextTokens)) {
        const token = await mode.evaluate((element, name) => {
          document.documentElement.setAttribute('data-memoly-theme', String(name))
          document.querySelector('.memoly-app-root')?.setAttribute('data-memoly-theme', String(name))
          const style = getComputedStyle(document.documentElement)
          const controlColor = getComputedStyle(element).color
          return { controlColor, themeText: style.getPropertyValue('--theme-text-muted').trim(), canvasTop: style.getPropertyValue('--theme-canvas-top').trim(), canvasBottom: style.getPropertyValue('--theme-canvas-bottom').trim() }
        }, theme)
        expect(token.controlColor).toBe('rgb(48, 42, 46)')
        expect(token.themeText).toBe(expectedToken)
        expect(contrastRatio(token.controlColor, token.canvasTop)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(token.controlColor, token.canvasBottom)).toBeGreaterThanOrEqual(4.5)
      }

      await exit.click()
      await expect(page.locator('.feed-unread-mode')).toHaveCount(0)
      await prisma.memorySeen.createMany({ data: ids.slice(1).map((memoryId) => ({ familyId: fixture.familyId, userId: fixture.userId, membershipEpoch: member.membershipEpoch, memoryId })) })
      await page.reload()
      await page.locator('[data-slot="family-hub"] .family-hub-card').click()
      const oneAction = page.locator('.feed-unread-action')
      await expect(oneAction).toHaveText('1 новое')
      await expect(oneAction).toHaveAttribute('aria-label', 'Показать 1 непросмотренное воспоминание')
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 })
        const metrics = await oneAction.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, whiteSpace: getComputedStyle(element).whiteSpace }
        })
        expect(metrics.width).toBeGreaterThanOrEqual(44)
        expect(metrics.height).toBeGreaterThanOrEqual(44)
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
        expect(metrics.whiteSpace).toBe('nowrap')
        await page.screenshot({ path: resolve(`e2e/.artifacts/feed-unread-${width}-one.png`), animations: 'disabled' })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('.feed-unread-action').focus()
      await page.keyboard.press('Space')
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 1')
      await page.getByRole('button', { name: 'Выйти из режима непросмотренных' }).click()
    } finally {
      await prisma.memorySeen.deleteMany({ where: { familyId: fixture.familyId, memoryId: { in: ids } } })
      await prisma.memory.deleteMany({ where: { id: { in: ids } } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: family.unreadTrackingActivatedAt, publicationOrdinal: family.publicationOrdinal } })
      await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: member.unreadBaselineOrdinal } })
    }
  })

  for (const width of [320, 390, 430, 480]) {
    test(`feed is usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await openFeed(page)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByTestId('bottom-navigation')).toBeVisible()
      const metrics = await page.evaluate(() => {
        const navigation = document.querySelector('[data-testid="bottom-navigation"]')
        const feedScroll = document.querySelector('[data-slot="feed-scroll"]')
        const header = document.querySelector('[data-child-header-mode="feed"]')
        if (!navigation || !feedScroll || !header) return null
        const navStyle = getComputedStyle(navigation)
        const scrollStyle = getComputedStyle(feedScroll)
        const navRect = navigation.getBoundingClientRect()
        return {
          clientWidth: document.documentElement.clientWidth,
          headerTop: header.getBoundingClientRect().top,
          scrollWidth: document.documentElement.scrollWidth,
          navBottom: navRect.bottom,
          navPaddingBottom: Number.parseFloat(navStyle.paddingBottom),
          navLeft: navRect.left,
          navWidth: navRect.width,
          scrollPaddingBottom: Number.parseFloat(scrollStyle.paddingBottom),
          viewportHeight: window.innerHeight,
        }
      })
      const unreadControl = page.locator('.feed-unread-action, .feed-unread-mode')

      expect(metrics).not.toBeNull()
      expect(metrics!.clientWidth).toBe(width)
      expect(metrics!.scrollWidth).toBeLessThanOrEqual(width)
      expect(metrics!.headerTop).toBeGreaterThanOrEqual(24)
      expect(metrics!.navWidth).toBe(width - 20)
      expect(metrics!.navLeft).toBe(10)
      expect(metrics!.navBottom).toBe(metrics!.viewportHeight)
      expect(metrics!.navPaddingBottom).toBe(18)
      expect(metrics!.scrollPaddingBottom).toBeGreaterThan(16)
      await expect(unreadControl).toHaveCount(0)
      await page.screenshot({ path: resolve(`e2e/.artifacts/task-5-feed-${width}.png`), fullPage: true })
    })
  }

  test('memory reactions stay lightweight, keyboard accessible, and theme-aware across phone sizes', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Фотоальбом E2E' })
    await expect(card.locator('[data-slot="memory-reactions"]')).toHaveCount(0)
    await expect(card.locator('.memory-like, .reaction-picker-trigger, .reaction-more')).toHaveCount(0)
    await expect(card.locator('.actions')).toHaveCount(0)
    for (const [width, height] of [[320, 568], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height })
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(`e2e/.artifacts/reactions-${width}x${height}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await page.evaluate((name) => {
        document.documentElement.setAttribute('data-memoly-theme', name)
        document.querySelector('.memoly-app-root')?.setAttribute('data-memoly-theme', name)
      }, theme)
      await expect(card.locator('.memory-card')).toHaveCount(0)
      await page.screenshot({ path: resolve(`e2e/.artifacts/reactions-${theme}-390.png`), animations: 'disabled' })
    }
    await page.keyboard.press('Tab')
    await card.focus()
    await expect(card).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Shift+F10')
    await expect(page.locator('.reaction-picker-options')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await expect(page.locator('.reaction-picker-options')).toHaveCount(0)
  })

  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    test(`feed renders the ${theme} theme at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openFeed(page)
      await selectTheme(page, theme)
      await page.getByRole('button', { name: 'Лента' }).click()
      await expect(page.locator('[data-slot="memoly-theme-root"]')).toHaveAttribute('data-memoly-theme', theme)
      await expect(page.locator('[data-slot="memoly-filter-rail"]')).toHaveCount(0)
      const navColors = await page.locator('[data-testid="bottom-navigation"]').evaluate((nav) => {
        const item = nav.querySelector('[data-nav-position="home"]')
        const icon = item?.querySelector('[data-slot="webp-icon"]')
        return item && icon ? {
          foreground: getComputedStyle(item).color,
          icon: getComputedStyle(icon).backgroundColor,
          mask: getComputedStyle(icon).maskImage,
        } : null
      })
      expect(navColors).not.toBeNull()
      expect(navColors!.icon).toBe(navColors!.foreground)
      expect(navColors!.mask).toContain('home-active')
      await page.screenshot({ path: resolve(`e2e/.artifacts/agent-b-feed-${theme}-390.png`), animations: 'disabled' })
    })
  }

  test('mixed card keeps all six Settings themes after reload at 320, 390, and 430px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await selectTheme(page, theme)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
      await openFeed(page)
      const card = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
      await expect(card).toHaveCount(1)
      await expect(card.locator('.memoly-mixed-slide')).toHaveCount(3)
      await expect(card.locator('[data-carousel-dot]')).toHaveCount(3)
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 })
        await card.scrollIntoViewIfNeeded()
        const layout = await card.evaluate((element) => {
          const cardBounds = element.getBoundingClientRect()
          const viewport = element.querySelector('.memoly-mixed-viewport')?.getBoundingClientRect()
          return { cardLeft: cardBounds.left, cardRight: cardBounds.right, viewportLeft: viewport?.left, viewportRight: viewport?.right, scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }
        })
        expect(layout.scrollWidth).toBeLessThanOrEqual(width)
        expect(layout.cardLeft).toBeGreaterThanOrEqual(0)
        expect(layout.cardRight).toBeLessThanOrEqual(width)
        expect(layout.viewportLeft).toBeGreaterThanOrEqual(layout.cardLeft)
        expect(layout.viewportRight).toBeLessThanOrEqual(layout.cardRight)
        const next = card.getByRole('button', { name: 'Следующий элемент' })
        await next.focus()
        await expect(next).toBeFocused()
        await expect(card.locator('[data-carousel-active="true"]')).toHaveAttribute('aria-label', '1 из 3, фото')
        if (width === 390) {
          await test.info().attach(`mm4-mixed-${theme}-390.png`, { body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
        }
      }
      await page.setViewportSize({ width: 390, height: 844 })
    }
  })

  test('private feed images survive three Feed → Family → Feed remounts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const photo = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).getByRole('img', { name: 'Воспоминание' })
    const photoFrame = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).locator('.memory-media-slot .ml-media-button')
    const videoPoster = page.locator('[data-memory-id]').filter({ hasText: 'Telegram video E2E' }).getByRole('img', { name: 'Кадр видео' })
    await expect(photo).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(photoFrame).toHaveCSS('overflow', 'hidden')
    await expect(photoFrame).toHaveCSS('border-radius', '0px')
    await expect(videoPoster).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => videoPoster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    for (let transition = 0; transition < 3; transition += 1) {
      await page.getByRole('button', { name: 'Семья', exact: true }).click()
      await expect(page.locator('[data-slot="family-presentation"]')).toBeVisible()
      await page.getByRole('button', { name: 'Лента', exact: true }).click()
      await expect(photo).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await expect(photoFrame).toHaveCSS('border-radius', '0px')
      await expect(videoPoster).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => videoPoster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
  })

  test('feed presents single photos in a fixed stage and preserves full image proportions in the viewer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const photos = [
      { body: 'Квадратное фото E2E', width: 360, height: 360, color: 'red' },
      { body: 'Горизонтальное фото E2E', width: 640, height: 360, color: 'teal' },
      { body: 'Вертикальное фото E2E', width: 360, height: 640, color: 'orange' },
    ].map((photo) => ({
      ...photo,
      memoryId: randomUUID(),
      mediaId: randomUUID(),
      bytes: generatedMedia(['-f', 'lavfi', '-i', `color=c=${photo.color}:s=${photo.width}x${photo.height}:d=0.1`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']),
    }))
    const photoByMediaId = new Map(photos.map((photo) => [photo.mediaId, photo]))

    await page.route(/\/api\/v1\/families\/[^/]+\/media\/[^/]+\/content\?variant=display/, async (route) => {
      const mediaId = new URL(route.request().url()).pathname.split('/').at(-2)
      const photo = mediaId ? photoByMediaId.get(mediaId) : undefined
      if (!photo) return route.continue()
      await route.fulfill({ body: photo.bytes, contentType: 'image/png' })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      const template = payload.items.find((item) => item.attachments.some((attachment) => attachment.kind === 'photo' && attachment.source === 'private_storage'))
      if (!template) return route.fulfill({ response, body: JSON.stringify(payload) })
      payload.items = [...photos.map((photo, index) => ({
        ...template,
        id: photo.memoryId,
        body: photo.body,
        occurredAt: new Date(Date.now() - index * 1_000).toISOString(),
        attachments: [{
          ...template.attachments[0],
          id: photo.mediaId,
          width: photo.width,
          height: photo.height,
          displayPath: `/api/v1/families/${template.familyId}/media/${photo.mediaId}/content?variant=display`,
        }],
      })), ...payload.items]
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })

    await page.reload()
    await openFeed(page)
    for (const photo of photos) {
      const card = page.locator('[data-memory-id]').filter({ hasText: photo.body })
      const image = card.getByRole('img', { name: 'Воспоминание' })
      const frame = card.getByRole('button', { name: 'Открыть фото' })
      await frame.scrollIntoViewIfNeeded()
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(photo.width)
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalHeight)).toBe(photo.height)
      await expect(frame).toHaveCSS('overflow', 'hidden')
      await expect(frame).toHaveCSS('border-radius', '0px')
      const geometry = await image.evaluate((element) => {
        const imageRect = element.getBoundingClientRect()
        const frameRect = element.closest('.ml-media-button')!.getBoundingClientRect()
        const wellRect = element.closest('.memory-media-slot')!.getBoundingClientRect()
        const actionsRect = element.closest('.memory-card')!.querySelector('.actions')!.getBoundingClientRect()
        return {
          imageWidth: imageRect.width, imageHeight: imageRect.height,
          frameWidth: frameRect.width, frameHeight: frameRect.height,
          imageTop: imageRect.top, imageBottom: imageRect.bottom,
          frameTop: frameRect.top, frameBottom: frameRect.bottom,
          wellBottom: wellRect.bottom, actionsTop: actionsRect.top,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
          objectFit: getComputedStyle(element).objectFit,
        }
      })
      expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(4 / 5, 2)
      expect(Math.abs(geometry.imageWidth - geometry.frameWidth)).toBeLessThan(2)
      expect(Math.abs(geometry.imageHeight - geometry.frameHeight)).toBeLessThan(2)
      expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.frameTop - 1)
      expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.frameBottom + 1)
      expect(geometry.wellBottom).toBeLessThanOrEqual(geometry.actionsTop + 1)
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      expect(geometry.objectFit).toBe('contain')
    }
    await page.screenshot({ path: resolve('e2e/.artifacts/feed-photo-no-crop.png'), fullPage: true })
    await page.locator('[data-memory-id]').filter({ hasText: 'Вертикальное фото E2E' }).getByRole('button', { name: 'Открыть фото' }).click()
    const fullPhoto = page.locator('.pswp__zoom-wrap > img').first()
    await expect(fullPhoto).toBeVisible()
    expect(await fullPhoto.evaluate((element) => element.getBoundingClientRect().width / element.getBoundingClientRect().height)).toBeCloseTo(360 / 640, 2)
    await page.locator('.pswp__button--close').click()
  })

  test('keeps card video overlays below navigation while fullscreen media covers it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const layers = await page.evaluate(() => {
      const navigation = document.querySelector('[data-testid="bottom-navigation"]')
      const overlay = document.querySelector('[data-slot="telegram-video-play-control"]')
      if (!navigation || !overlay) return null
      return {
        navigationPosition: getComputedStyle(navigation).position,
        navigationZIndex: Number.parseInt(getComputedStyle(navigation).zIndex, 10),
        overlayZIndex: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
      }
    })

    expect(layers).not.toBeNull()
    expect(layers!.navigationPosition).toBe('fixed')
    expect(layers!.navigationZIndex).toBeGreaterThan(layers!.overlayZIndex)

    const opener = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).getByRole('button', { name: 'Открыть фото' }).first()
    await opener.scrollIntoViewIfNeeded()
    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    const fullscreenZIndex = await page.locator('.pswp').evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10))
    expect(fullscreenZIndex).toBeGreaterThan(layers!.navigationZIndex)
    await page.locator('.pswp__button--close').click()
  })

  test('renders intrinsic photo and MAX video ratios and opens the memoLy bot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const maxVideos = [
      { body: 'MAX portrait video UX E2E', width: null, height: 720, decodedWidth: 720, decodedHeight: 1_280, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=orange:s=720x1280:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
      { body: 'MAX landscape video UX E2E', width: 1_280, height: 720, decodedWidth: 1_280, decodedHeight: 720, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=teal:s=1280x720:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
      { body: 'MAX square video UX E2E', width: 900, height: 900, decodedWidth: 900, decodedHeight: 900, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=purple:s=900x900:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
    ].map((video) => ({ ...video, id: randomUUID(), posterMediaId: randomUUID() }))
    const maxVideoById = new Map(maxVideos.map((video) => [video.id, video.bytes]))
    const maxVideoLikedByMe = new Map(maxVideos.map((video) => [video.id, false]))
    const maxVideoRequests: string[] = []
    const maxPosterRequests: Array<{ method: string; origin: string | null }> = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/media/max-videos/') && url.endsWith('/content')) maxVideoRequests.push(url)
    })

    for (const video of maxVideos) {
      await page.context().route(`**/media/${video.posterMediaId}/content*`, async (route) => {
        maxPosterRequests.push({ method: route.request().method(), origin: route.request().headers().origin ?? null })
        await route.fulfill({ body: pngImage.buffer, contentType: pngImage.mimeType, headers: { 'Cache-Control': 'private, no-cache', ETag: '"synthetic-poster"' } })
      })
    }

    await page.route('**/api/v1/families/*/media/max-videos/*/content', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/')
      const referenceId = segments[segments.length - 2]
      const bytes = referenceId ? maxVideoById.get(referenceId) : undefined
      if (!bytes) return route.continue()
      await route.fulfill({ body: bytes, contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' } })
    })
    await page.route('**/api/v1/families/*/media/max-videos/*/readiness', async (route) => {
      const referenceId = new URL(route.request().url()).pathname.split('/').at(-2)
      if (!referenceId || !maxVideoById.has(referenceId)) return route.continue()
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'ready', recheckable: false }) })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.searchParams.has('cursor')) return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      const first = payload.items[0]
      if (!first) return route.fulfill({ response, body: JSON.stringify(payload) })
      const now = new Date().toISOString()
      payload.items = [
        ...maxVideos.map((video) => ({
          ...first,
          id: video.id,
          kind: 'video',
          body: video.body,
          occurredAt: now,
          createdAt: now,
          likes: { count: maxVideoLikedByMe.get(video.id) ? 1 : 0, likedByMe: maxVideoLikedByMe.get(video.id) ?? false },
          reactionCounts: maxVideoLikedByMe.get(video.id) ? { heart: 1 } : {},
          currentUserReaction: maxVideoLikedByMe.get(video.id) ? 'heart' : null,
          attachments: [{
            id: randomUUID(), source: 'max', kind: 'video', width: video.width, height: video.height,
            durationMs: 2_000, playbackPath: `/api/v1/families/${first.familyId}/media/max-videos/${video.id}/content`,
            posterState: 'ready', posterPath: `/api/v1/families/${first.familyId}/media/${video.posterMediaId}/content?variant=display`,
          }],
        })),
        ...payload.items.map((item) => {
          if (item.body === 'Фотоальбом E2E') {
            return { ...item, attachments: item.attachments.map((attachment, index) => {
              const changed = index === 0 ? { ...attachment, width: 360, height: 640 } : { ...attachment, width: 640, height: 360 }
              return changed
            }) }
          }
          if (item.body === 'Одиночное фото E2E') {
            return { ...item, attachments: item.attachments.map((attachment) => {
              const changed = { ...attachment, width: 500, height: 500 }
              return changed
            }) }
          }
          return item
        }),
      ]
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/')
      const targetId = segments[segments.length - 2]
      if (!targetId || !maxVideoLikedByMe.has(targetId)) return route.continue()
      const payload = route.request().postDataJSON() as { reaction?: unknown }
      if (payload.reaction !== null && payload.reaction !== 'heart') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_REQUEST' } }) })
      const liked = payload.reaction === 'heart'
      maxVideoLikedByMe.set(targetId, liked)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reactionCounts: liked ? { heart: 1 } : {}, currentUserReaction: liked ? 'heart' : null, likes: { count: liked ? 1 : 0, likedByMe: liked } }) })
    })

    // Keep this browser-only provider fixture on the page request path so Playwright can
    // deterministically serve the synthetic MP4; the production service worker remains covered
    // by the existing private-media E2E cases.
    await page.evaluate(async () => {
      await Promise.all((await navigator.serviceWorker?.getRegistrations() ?? []).map((registration) => registration.unregister()))
    })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined })
    })
    await page.addInitScript(() => {
      const originalLoad = HTMLMediaElement.prototype.load
      const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
      let explicitLoadCalls = 0
      let maxVideoSourceAssignments = 0
      HTMLMediaElement.prototype.load = function () {
        if (this.getAttribute('src')?.includes('/media/max-videos/')) explicitLoadCalls += 1
        return originalLoad.call(this)
      }
      if (sourceDescriptor?.get && sourceDescriptor.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          configurable: sourceDescriptor.configurable,
          enumerable: sourceDescriptor.enumerable,
          get: sourceDescriptor.get,
          set(value: string) {
            if (this instanceof HTMLVideoElement && value.includes('/media/max-videos/')) maxVideoSourceAssignments += 1
            sourceDescriptor.set!.call(this, value)
          },
        })
      }
      Object.defineProperties(window, {
        __maxVideoExplicitLoadCalls: { configurable: true, get: () => explicitLoadCalls },
        __maxVideoSourceAssignments: { configurable: true, get: () => maxVideoSourceAssignments },
      })
    })
    await page.reload()
    const maxWelcomeContinue = page.getByRole('button', { name: 'Продолжить' })
    await expect(maxWelcomeContinue).toBeVisible()
    await expect(maxWelcomeContinue).toBeEnabled()
    await maxWelcomeContinue.click()
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await openFeed(page)
    const ratios = [
      ['Фотоальбом E2E', 'img', 4 / 5],
      ['Одиночное фото E2E', 'img', 4 / 5],
      // MAX videos stay in the canonical 4:5 Feed stage; the intrinsic frame is contained inside it.
      ...maxVideos.map((video) => [video.body, 'video', 4 / 5] as const),
    ] as const
    for (const [body, element, expected] of ratios) {
      const card = page.locator('[data-memory-id]').filter({ hasText: body })
      await expect(card).toBeVisible()
      await card.scrollIntoViewIfNeeded()
      const media = element === 'img'
        ? card.locator('[data-slot="memoly-photo-layout"] img').first()
        : card.locator('video').first()
      await expect(media).toBeVisible()
      if (element === 'video') await expect(media).toHaveAttribute('poster', /^blob:/)
      const actual = await media.evaluate((entry) => {
        const rect = entry.getBoundingClientRect()
        return { ratio: rect.width / rect.height, objectFit: getComputedStyle(entry).objectFit }
      })
      expect(actual.ratio).toBeCloseTo(expected, 2)
      if (element === 'img') expect(actual.objectFit).toBe('contain')
      else expect(actual.objectFit).toBe('contain')
      if (element === 'video') {
        const posterUrl = await media.getAttribute('poster')
        expect(posterUrl).toMatch(/^blob:/)
        const decodedPoster = await page.evaluate(async (src) => {
          const image = new Image()
          image.src = src
          await image.decode()
          return { width: image.naturalWidth, height: image.naturalHeight }
        }, posterUrl!)
        expect(decodedPoster).toMatchObject({ width: 1, height: 1 })
      }
    }

    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed-media-ux.png'), fullPage: true })
    const albumOpener = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).getByRole('button', { name: 'Открыть фото' })
    await albumOpener.click()
    const fullscreenPhoto = page.locator('.pswp__zoom-wrap > img').first()
    await expect(fullscreenPhoto).toBeVisible()
    const fullscreenRatio = await fullscreenPhoto.evaluate((entry) => {
      const rect = entry.getBoundingClientRect()
      return rect.width / rect.height
    })
    expect(fullscreenRatio).toBeCloseTo(360 / 640, 2)
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed-media-ux-fullscreen.png') })
    await page.locator('.pswp__button--close').click()

    const maxVideoCard = page.locator('[data-memory-id]').filter({ hasText: maxVideos[0]!.body })
    const maxVideo = maxVideoCard.locator('video').first()
    await maxVideoCard.scrollIntoViewIfNeeded()
    await expect.poll(() => maxPosterRequests.length).toBeGreaterThanOrEqual(maxVideos.length)
    await expect(maxVideo).toHaveAttribute('preload', 'none')
    await expect(maxVideo).toHaveAttribute('src', /\/media\/max-videos\/[^#]+\/content$/)
    expect(await maxVideo.evaluate((entry) => entry.src.includes('#'))).toBe(false)
    await expect(maxVideo).toHaveAttribute('poster', /^blob:/)
    await expect(maxVideoCard.locator('[data-video-viewer-state="ready"]')).toHaveAttribute('data-seen-ready', 'true')
    await page.screenshot({ path: resolve('e2e/.artifacts/max-poster-before-play.png'), animations: 'disabled' })
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxVideoExplicitLoadCalls?: number }).__maxVideoExplicitLoadCalls ?? 0)).toBe(0)
    expect(await page.evaluate(() => (window as typeof window & { __maxVideoSourceAssignments?: number }).__maxVideoSourceAssignments ?? 0)).toBe(maxVideos.length)
    expect(maxVideoRequests).toHaveLength(0)
    await expect(maxVideo).toHaveAttribute('controls', '')
    await expect(maxVideo).toHaveAttribute('playsinline', '')
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    expect(await maxVideo.evaluate((entry) => entry.muted)).toBe(false)
    await expect(maxVideoCard.getByRole('button', { name: 'Открыть', exact: true })).toHaveCount(0)
    await expect(maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' })).toHaveCount(1)
    await maxVideoCard.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('button', { name: 'Сердце', exact: true }).click()
    await expect(maxVideoCard.locator('[data-reaction="heart"]')).toContainText('1')
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    await page.getByRole('button', { name: 'Подробнее' }).click()
    await expect(page.getByRole('dialog')).toContainText(maxVideos[0]!.body)
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-detail-390.png'), animations: 'disabled' })
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click()
    await expect(maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()
    await maxVideoCard.getByRole('button', { name: 'Смотреть видео' }).click()
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(false)
    await expect.poll(() => maxVideo.evaluate((entry) => entry.readyState)).toBeGreaterThanOrEqual(2)
    expect(maxVideoRequests.length).toBeGreaterThan(0)
    expect(maxVideoRequests.every((url) => !url.includes('#'))).toBe(true)
    expect(await page.evaluate(() => (window as typeof window & { __openedMaxLink?: string }).__openedMaxLink)).toBeUndefined()
    await expect(maxVideoCard.getByRole('button', { name: 'Открыть в MAX' })).toHaveCount(0)
    await maxVideo.evaluate((element) => element.dispatchEvent(new Event('error')))
    await expect(maxVideoCard).toContainText('Не удалось загрузить видео')
    await maxVideoCard.getByRole('button', { name: 'Открыть в MAX' }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __openedMaxLink?: string }).__openedMaxLink)).toBe('https://max.ru/memoLy')
  })

  test('keeps page one through a next-page failure, retries, and deduplicates 40+ memories', async ({ page }) => {
    let failedOnce = false
    let blockCursor = true
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const url = new URL(route.request().url())
      if (blockCursor && url.searchParams.has('cursor')) {
        failedOnce = true
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic page failure' } }),
        })
        return
      }
      await route.continue()
    })

    await openFeed(page)
    await page.getByTestId('feed-load-more-sentinel').scrollIntoViewIfNeeded()
    await expect.poll(() => failedOnce).toBe(true)
    await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить ещё' })).toBeVisible()
    blockCursor = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText('Заметка E2E 20')).toBeVisible()
    await page.getByTestId('feed-load-more-sentinel').scrollIntoViewIfNeeded()
    await expect(page.getByText('Заметка E2E 42')).toBeVisible()

    const cards = page.locator('[data-memory-id]')
    await expect(cards).toHaveCount(fixture.memoryCount)
    const ids = await cards.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-memory-id')))
    expect(new Set(ids).size).toBe(ids.length)
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed.png'), fullPage: true })
  })

  test('rolls back a failed like without losing the memory', async ({ page }) => {
    await openFeed(page)
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toContainText('Просмотр')
    await expect(page.getByRole('button', { name: 'Добавить' })).toHaveCount(0)
    await page.route('**/api/v1/families/*/memories/*/reaction', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic like failure' } }),
    }))
    const albumCard = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' })
    await expect(albumCard.locator('[data-slot="memory-reactions"]')).toHaveCount(0)
    await expect(albumCard.getByRole('button', { name: 'Действия с воспоминанием' })).toHaveCount(1)
    const image = albumCard.locator('.memory-media-slot img').first()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.locator('.reaction-picker-options')).toBeVisible()
    await page.mouse.up()
    await page.getByRole('button', { name: 'Сердце' }).click()
    await expect(albumCard.locator('[data-slot="memory-reactions"]')).toHaveCount(0)
    await expect(albumCard).toContainText('Фотоальбом E2E')
  })

  test('opens the approved Add sheet with three horizontal options across mobile viewports', async ({ page }) => {
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })

    try {
      for (const width of [320, 390, 430, 480]) {
        await page.setViewportSize({ width, height: 844 })
        await page.goto('/')
        await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
        await openFeed(page)
        await page.getByRole('button', { name: 'Добавить', exact: true }).click()

        const panel = page.locator('[data-slot="memoly-add-sheet-panel"]')
        await expect(panel).toBeVisible()
        await expect(page.locator('[data-slot="memoly-bottom-sheet-handle"]')).toHaveCount(1)
        await expect(page.locator('[data-slot="drawer-handle"]')).toHaveCount(0)
        await expect(panel.getByRole('heading', { name: 'Добавить воспоминание', exact: true })).toBeVisible()
        await expect(panel.getByText('Сохраняйте моменты, которые важны', { exact: true })).toBeVisible()

        const options = panel.locator('[data-add-action]')
        await expect(options).toHaveCount(3)
        await expect(options.nth(0)).toHaveAttribute('data-add-action', 'photo')
        await expect(options.nth(0)).toHaveAccessibleName('Добавить фото и видео')
        await expect(options.nth(1)).toHaveAttribute('data-add-action', 'note')
        await expect(options.nth(1)).toHaveAccessibleName('Добавить заметку')
        await expect(options.nth(2)).toHaveAttribute('data-add-action', 'voice-or-video')
        await expect(options.nth(2)).toHaveAccessibleName('Добавить голос или видео')
        for (let index = 0; index < 3; index += 1) await expect(options.nth(index)).toBeVisible()
        await page.waitForTimeout(500)

        const geometry = await options.evaluateAll((entries) => {
          const rects = entries.map((entry) => entry.getBoundingClientRect())
          const navigation = document.querySelector('[data-testid="bottom-navigation"]')
          const sheet = document.querySelector('[data-memoly-bottom-sheet="true"]')
          if (!navigation || !sheet) return null
          const navRect = navigation.getBoundingClientRect()
          const sheetRect = sheet.getBoundingClientRect()
          const navStyle = getComputedStyle(navigation)
          return {
            maxRight: Math.max(...rects.map((rect) => rect.right)),
            minLeft: Math.min(...rects.map((rect) => rect.left)),
            minTop: Math.min(...rects.map((rect) => rect.top)),
            maxTop: Math.max(...rects.map((rect) => rect.top)),
            maxBottom: Math.max(...rects.map((rect) => rect.bottom)),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            navTop: navRect.top,
            navBottom: navRect.bottom,
            navPaddingBottom: Number.parseFloat(navStyle.paddingBottom),
            sheetBottom: sheetRect.bottom,
            navCovered: Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 40)?.closest('[data-memoly-bottom-sheet="true"]')),
          }
        })
        expect(geometry).not.toBeNull()
        expect(geometry!.minLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.maxRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.maxBottom).toBeLessThanOrEqual(geometry!.viewportHeight - 12)
        expect(geometry!.documentWidth).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.maxTop - geometry!.minTop).toBeLessThanOrEqual(1)
        expect(geometry!.navBottom).toBe(geometry!.viewportHeight)
        expect(geometry!.navTop).toBeLessThan(geometry!.navBottom)
        expect(geometry!.navPaddingBottom).toBeGreaterThanOrEqual(0)
        expect(geometry!.navCovered).toBe(true)
        if (width === 320 || width === 390) {
          const sheetTop = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => element.getBoundingClientRect().top)
          expect(sheetTop).toBeGreaterThanOrEqual(width === 320 ? 631 : 640)
          expect(sheetTop).toBeLessThanOrEqual(width === 320 ? 637 : 652)
          expect(geometry!.minTop).toBeGreaterThanOrEqual(700)
        }

        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-add-${width}.png`), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Добавить', exact: true }).click()
      await page.waitForTimeout(500)
      for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
        await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), theme)
        const top = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => element.getBoundingClientRect().top)
        expect(top).toBeGreaterThanOrEqual(640)
        expect(top).toBeLessThanOrEqual(652)
        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-add-${theme}-390.png`), animations: 'disabled' })
      }
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
      const addButton = page.getByRole('button', { name: 'Добавить', exact: true })
      await expect(addButton).toBeFocused()
      await addButton.click()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
      const textScale = await page.addStyleTag({ content: `.memoly-add-sheet-panel .sheet-title { font-size: 32px !important; } .memoly-add-sheet-panel .sheet-subtitle { font-size: 22px !important; } .memoly-add-sheet-panel .add-option-title { font-size: 26px !important; } .memoly-add-sheet-panel .add-option-copy { font-size: 20px !important; }` })
      await page.waitForTimeout(500)
      const scaledLayout = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, right: rect.right, bottom: rect.bottom, scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
      })
      expect(scaledLayout.top).toBeGreaterThanOrEqual(0)
      expect(scaledLayout.right).toBeLessThanOrEqual(scaledLayout.viewportWidth)
      expect(scaledLayout.bottom).toBeLessThanOrEqual(844)
      expect(scaledLayout.scrollWidth).toBeLessThanOrEqual(scaledLayout.viewportWidth)
      await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-add-text-200-390.png'), animations: 'disabled' })
      await textScale.evaluate((element) => element.remove())
      await page.getByRole('button', { name: 'Добавить голос или видео' }).click()
      await expect(page.locator('[data-slot="memoly-voice-video-sheet"]')).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
      await page.goBack()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
      await addButton.click()
      await page.getByRole('button', { name: 'Добавить заметку' }).click()
      await expect(page.getByRole('heading', { name: 'Добавить заметку' })).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
      await addButton.click()
      await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
      await expect(page.getByRole('heading', { name: 'Добавить фото и видео' })).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
    } finally {
      await prisma.familyMember.update({
        where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
        data: { role: 'viewer' },
      })
    }
  })

  test('keeps delete spotlight and navigation within required mobile viewports', async ({ page }) => {
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })

    try {
      await page.reload()
      await openFeed(page)
      const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Заметка E2E 42' })
      for (let pageIndex = 0; pageIndex < 4 && await card.count() === 0; pageIndex += 1) {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
        await page.waitForTimeout(250)
      }
      await expect(card).toHaveCount(1)
      const selectedId = await card.getAttribute('data-memory-id')
      expect(selectedId).toBeTruthy()

      for (const width of [320, 390, 430, 480]) {
        await page.setViewportSize({ width, height: 844 })
        await card.scrollIntoViewIfNeeded()
        await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
        await page.getByRole('button', { name: 'Удалить воспоминание' }).click()

        const spotlight = page.getByRole('alertdialog')
        await expect(spotlight).toContainText('Удалить воспоминание?')
        const selectedCard = page.locator(`[data-memory-id="${selectedId}"]`)
        await expect(selectedCard).toHaveCount(1)
        await expect(selectedCard).toBeVisible()

        const geometry = await spotlight.evaluate((dialog, id) => {
          const dialogRect = dialog.getBoundingClientRect()
          const source = document.querySelector<HTMLElement>(`[data-memory-id="${id}"]`)
          const navigation = document.querySelector('[data-testid="bottom-navigation"]')
          const overlay = document.querySelector<HTMLElement>('.memoly-delete-overlay')
          if (!source || !navigation || !overlay) return null
          const sourceRect = source.getBoundingClientRect()
          const navRect = navigation.getBoundingClientRect()
          const navStyle = getComputedStyle(navigation)
          return {
            dialogLeft: dialogRect.left,
            dialogRight: dialogRect.right,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
            sourceLeft: sourceRect.left,
            sourceRight: sourceRect.right,
            sourceTop: sourceRect.top,
            sourceBottom: sourceRect.bottom,
            navTop: navRect.top,
            navBottom: navRect.bottom,
            navZIndex: Number.parseInt(navStyle.zIndex, 10),
            overlayZIndex: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          }
        }, selectedId)
        expect(geometry).not.toBeNull()
        expect(geometry!.dialogLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.dialogRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.dialogTop).toBeGreaterThanOrEqual(0)
        expect(geometry!.dialogBottom).toBeLessThanOrEqual(geometry!.viewportHeight)
        expect(geometry!.sourceLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.sourceRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.sourceBottom).toBeGreaterThan(0)
        expect(geometry!.sourceTop).toBeLessThan(geometry!.viewportHeight)
        expect(geometry!.navBottom).toBe(geometry!.viewportHeight)
        expect(geometry!.navTop).toBeLessThan(geometry!.navBottom)
        expect(geometry!.navZIndex).toBeGreaterThan(geometry!.overlayZIndex)
        expect(geometry!.documentWidth).toBeLessThanOrEqual(geometry!.viewportWidth)

        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-delete-${width}.png`), animations: 'disabled' })
        await page.getByRole('button', { name: 'Отмена' }).click()
        await expect(spotlight).toHaveCount(0)
        await expect(selectedCard).toBeVisible()
      }
    } finally {
      await prisma.familyMember.update({
        where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
        data: { role: 'viewer' },
      })
    }
  })

  test('offers only truly newer memories and preserves the visible anchor when applying them', async ({ page }) => {
    await openFeed(page)
    const target = page.locator('[data-memory-id]').filter({ hasText: 'Заметка E2E 10' })
    await target.scrollIntoViewIfNeeded()
    const anchorId = await page.locator('[data-memory-id]').evaluateAll((cards) =>
      cards.find((card) => {
        const rect = card.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })?.getAttribute('data-memory-id'))
    const anchor = page.locator(`[data-memory-id="${anchorId}"]`)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Старая добавленная запись', occurredAt: new Date(Date.now() - 7 * 24 * 60 * 60_000), firstPublishedAt: new Date(),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Совсем новое воспоминание', occurredAt: new Date(), firstPublishedAt: new Date(),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toBeVisible()
    const beforeTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    await page.getByRole('button', { name: 'Показать новые' }).click()
    await expect(page.getByText('Совсем новое воспоминание')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)
    const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2)
  })

  test('opens a two-photo PhotoSwipe album and restores focus and scroll on close', async ({ page }) => {
    await openFeed(page)
    const singleOpener = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).getByRole('button', { name: 'Открыть фото' })
    await singleOpener.scrollIntoViewIfNeeded()
    await installObjectUrlTracker(page)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    const singleScroll = await page.evaluate(() => window.scrollY)
    await singleOpener.click()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 1')
    await expect(page.locator('.pswp__zoom-wrap > img')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(1)
    await page.locator('.pswp__button--close').click()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(singleOpener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(singleScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 1)

    const opener = page.getByRole('button', { name: 'Открыть фото' }).first()
    await opener.scrollIntoViewIfNeeded()
    const beforeScroll = await page.evaluate(() => window.scrollY)
    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 2')
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(3)
    await page.locator('.pswp__button--arrow--next').click()
    await expect(page.locator('.pswp__counter')).toContainText('2 / 2')
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-photoswipe.png') })
    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 3)

    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.privatePhotoViewer))).toBe(false)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(5)
    await page.goBack()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 5)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(7)
    await page.getByRole('button', { name: 'Семья', exact: true }).evaluate((button) => (button as HTMLButtonElement).click())
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 7)
  })

  test('mixed carousel swipes, scrolls vertically, pauses video, and opens the selected item', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    let openedPhotoRequests = 0
    page.on('request', (request) => { if (request.url().includes(fixture.mixedLastPhotoId) && request.url().includes('variant=display')) openedPhotoRequests += 1 })
    await openFeed(page)
    const card = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('[data-carousel-dot]')).toHaveCount(3)
    await expect(card.locator('[data-carousel-active="true"] [data-seen-ready="true"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/mm3-card-photo.png'), animations: 'disabled' })
    const viewport = card.locator('.memoly-mixed-viewport')
    await expect(viewport).toHaveCSS('touch-action', 'pan-y pinch-zoom')
    const stageHeight = await viewport.evaluate((element) => element.getBoundingClientRect().height)
    const before = await page.evaluate(() => window.scrollY)
    await viewport.hover()
    await page.mouse.wheel(0, 180)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
    await card.scrollIntoViewIfNeeded()
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error('mixed carousel viewport is missing')
    const y = bounds.y + Math.min(bounds.height / 2, 80)
    await page.mouse.move(bounds.x + bounds.width * .8, y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * .2, y, { steps: 8 })
    await page.mouse.up()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    expect(await viewport.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(stageHeight, 1)
    await expect(card.getByRole('button', { name: 'Открыть фото' })).toHaveCount(0)
    await expect.poll(() => card.evaluate((element) => {
      const viewport = element.querySelector('.memoly-mixed-viewport')?.getBoundingClientRect()
      const active = element.querySelector('[data-carousel-active="true"]')?.getBoundingClientRect()
      return viewport && active ? Math.abs(viewport.left - active.left) : Number.POSITIVE_INFINITY
    })).toBeLessThan(2)
    const video = card.locator('video')
    await expect(video).toHaveCount(1)
    await expect(video).not.toHaveAttribute('autoplay', /.*/)
    await expect(card.locator('[data-carousel-active="true"] [data-seen-ready="true"]')).toBeVisible()
    const previous = card.getByRole('button', { name: 'Предыдущий элемент' })
    await previous.focus()
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-carousel-active="true"]')))).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/mm3-card-video.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 500 })
    await card.scrollIntoViewIfNeeded()
    const shortStage = await viewport.evaluate((element) => {
      const viewportRect = element.getBoundingClientRect()
      const slideRect = element.querySelector('[data-carousel-active="true"]')!.getBoundingClientRect()
      const seek = element.querySelector('[data-carousel-active="true"] input[type="range"]') as HTMLInputElement | null
      return {
        ratio: viewportRect.width / viewportRect.height,
        viewportHeight: viewportRect.height,
        slideHeight: slideRect.height,
        seekHeight: seek?.getBoundingClientRect().height ?? 0,
        seekMinHeight: seek ? Number.parseFloat(getComputedStyle(seek).minHeight) : 0,
      }
    })
    expect(shortStage.ratio).toBeCloseTo(4 / 5, 2)
    expect(Math.abs(shortStage.viewportHeight - shortStage.slideHeight)).toBeLessThan(2)
    expect(shortStage.seekHeight).toBeGreaterThanOrEqual(44)
    expect(shortStage.seekMinHeight).toBeGreaterThanOrEqual(44)
    await page.setViewportSize({ width: 390, height: 844 })
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'Воспроизвести видео' }).click()
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-carousel-dot="3"]')).toHaveAttribute('aria-current', 'step')
    expect(await viewport.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(stageHeight, 1)
    await expect(video).toHaveCount(0)
    await expect(card.locator('[data-carousel-active="true"] [data-seen-ready="true"]')).toBeVisible()
    expect(openedPhotoRequests).toBeGreaterThan(0)
    const beforeViewerRequests = openedPhotoRequests
    await card.getByRole('button', { name: 'Открыть фото' }).click()
    const viewer = page.locator('[data-mixed-viewer]')
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('3 / 3')
    await expect(viewer.locator('img')).toBeVisible()
    expect(openedPhotoRequests).toBe(beforeViewerRequests)
    await page.screenshot({ path: resolve('e2e/.artifacts/mm3-mixed-photo.png'), animations: 'disabled' })
    await page.keyboard.press('ArrowLeft')
    await expect(viewer).toContainText('2 / 3')
    await expect(viewer.locator('video')).toHaveCount(1)
    await expect(viewer.locator('[data-seen-ready="true"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/mm3-mixed-video.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(card.locator('[data-carousel-dot="3"]')).toHaveAttribute('aria-current', 'step')
    // This checks mixed-card token/layout behavior in all six themes without changing the user's saved theme.
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await page.evaluate((name) => { document.documentElement.dataset.memolyTheme = name; document.querySelector<HTMLElement>('[data-slot="memoly-theme-root"]')!.dataset.memolyTheme = name }, theme)
      await expect(card.locator('.memoly-mixed-dots')).toBeVisible()
      await expect(card.locator('[data-carousel-dot]')).toHaveCount(3)
      const layout = await card.evaluate((element) => ({ width: element.getBoundingClientRect().width, scrollWidth: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
      expect(layout.width).toBeGreaterThan(0)
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport)
    }
  })

  test('MAX mixed slide checks readiness only when active and replaces processing with ready in place', async ({ page }) => {
    const referenceId = randomUUID()
    const attachmentId = randomUUID()
    const contentPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/content`
    const readinessPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/readiness`
    let checks = 0
    let mockedReadiness: 'processing' | 'unknown' | 'ready' = 'processing'
    const checkTimes: number[] = []
    const contentRequests: string[] = []
    page.on('request', (request) => { if (request.url().includes(contentPath)) contentRequests.push(request.url()) })
    await page.route(`**${readinessPath}`, async (route) => {
      checks += 1
      checkTimes.push(Date.now())
      const state = mockedReadiness
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state, recheckable: state !== 'ready' }) })
    })
    const bytes = generatedMedia(['-f', 'lavfi', '-i', 'color=c=teal:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
    // Private video playback is fetched by the service worker, outside page.route.
    await page.context().route(`**${contentPath}`, (route) => route.fulfill({ body: bytes, contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' } }))
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.endsWith('/memories')) return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      payload.items = payload.items.map((item) => item.body === 'Смешанное воспоминание E2E'
        ? { ...item, attachments: item.attachments.map((attachment, index) => index === 1
          ? { id: attachmentId, source: 'max', kind: 'video', width: 320, height: 180, durationMs: 2_000, playbackPath: contentPath }
          : attachment) }
        : item)
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.evaluate(async () => { await Promise.all((await navigator.serviceWorker?.getRegistrations() ?? []).map((registration) => registration.unregister())) })
    await page.reload()
    await openFeed(page)
    const card = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
    const waitForActiveSlideAlignment = async () => {
      let previousDelta: number | null = null
      let stableFrames = 0
      await expect.poll(async () => {
        const delta = await card.evaluate((element) => {
          const viewport = element.querySelector('.memoly-mixed-viewport')!
          const slide = element.querySelector('[data-carousel-active="true"]')!
          return slide.getBoundingClientRect().left - viewport.getBoundingClientRect().left
        })
        stableFrames = Math.abs(delta) < 1 && previousDelta !== null && Math.abs(delta - previousDelta) < 0.05
          ? stableFrames + 1 : 0
        previousDelta = delta
        return stableFrames
      }, { intervals: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40], timeout: 5_000 }).toBeGreaterThanOrEqual(3)
    }
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('[data-carousel-dot]')).toHaveCount(3)
    expect(checks).toBe(0)
    expect(contentRequests).toHaveLength(0)
    const cardHandle = await card.elementHandle()
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    await expect(card.locator('[data-video-viewer-state="processing"]')).toBeVisible()
    await expect(card.getByText('Видео обрабатывается…')).toBeVisible()
    await waitForActiveSlideAlignment()
    await test.info().attach('int1-max-video-processing-card.png', {
      body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })
    expect(contentRequests).toHaveLength(0)
    expect(checks).toBe(1)
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-carousel-dot="3"]')).toHaveAttribute('aria-current', 'step')
    await card.getByRole('button', { name: 'Предыдущий элемент' }).click()
    await expect(card.locator('[data-video-viewer-state="processing"]')).toBeVisible()
    await page.waitForTimeout(500)
    expect(checks, `readiness checks after carousel remount: ${checkTimes.map((time) => time - checkTimes[0]!)}`).toBe(1)
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-carousel-dot="3"]')).toHaveAttribute('aria-current', 'step')
    await expect(card.locator('[data-video-viewer-state]')).toHaveCount(0)
    await page.waitForTimeout(5_200)
    expect(checks).toBe(1)
    await card.getByRole('button', { name: 'Предыдущий элемент' }).click()
    await expect(card.locator('[data-video-viewer-state="processing"]')).toBeVisible()
    await expect.poll(() => checks, { timeout: 2_000 }).toBe(2)
    mockedReadiness = 'unknown'
    await card.getByRole('button', { name: 'Проверить готовность' }).click()
    await expect(card.locator('[data-video-viewer-state="unknown"]')).toBeVisible()
    await expect(card.getByText('Готовность видео пока неизвестна')).toBeVisible()
    await expect(card.getByText('Не удалось загрузить видео')).toHaveCount(0)
    expect(contentRequests).toHaveLength(0)
    mockedReadiness = 'ready'
    await card.getByRole('button', { name: 'Проверить готовность' }).click()
    await expect.poll(() => checks).toBe(4)
    await expect(card.locator('video')).toHaveAttribute('src', new RegExp(`${referenceId}/content$`))
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    await waitForActiveSlideAlignment()
    await expect.poll(() => card.locator('[data-carousel-active="true"] video').evaluate((video: HTMLVideoElement) => ({
      width: video.videoWidth, height: video.videoHeight, hasMetadata: video.readyState >= 1, error: video.error?.code ?? null,
    }))).toMatchObject({ width: 320, height: 180, hasMetadata: true, error: null })
    await expect(card.getByText('Не удалось загрузить видео')).toHaveCount(0)
    await expect(card.locator('[data-carousel-active="true"] [role="alert"]')).toHaveCount(0)
    expect(await card.evaluate((element, original) => element === original, cardHandle)).toBe(true)
    expect(contentRequests.some((url) => url.includes(contentPath))).toBe(true)
    await test.info().attach('int1-max-video-ready-card.png', {
      body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })
  })

  test('MAX poster lifecycle shows the generated poster in place while playback stays untouched', async ({ page }) => {
    const referenceId = randomUUID()
    const posterMediaId = randomUUID()
    const contentPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/content`
    const readinessPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/readiness`
    const posterReadinessPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/poster-readiness`
    const posterPath = `/api/v1/families/${fixture.familyId}/media/${posterMediaId}/content?variant=display`
    let posterChecks = 0
    const playbackRequests: string[] = []
    const posterMediaRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes(contentPath)) playbackRequests.push(request.url())
      if (request.url().includes(`/media/${posterMediaId}/content`)) posterMediaRequests.push(new URL(request.url()).pathname + new URL(request.url()).search)
    })
    await page.route(`**${readinessPath}`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'processing', recheckable: true }) }))
    await page.route(`**${posterReadinessPath}`, async (route) => {
      posterChecks += 1
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(posterChecks < 2 ? { state: 'pending' } : { state: 'ready', posterPath }) })
    })
    await page.context().route(`**/media/${posterMediaId}/content*`, (route) => route.fulfill({
      body: pngImage.buffer, contentType: pngImage.mimeType, headers: { 'Cache-Control': 'private, no-cache' },
    }))
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.endsWith('/memories')) return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      payload.items = payload.items.map((item) => item.body === 'Смешанное воспоминание E2E'
        ? { ...item, attachments: item.attachments.map((attachment, index) => index === 1
          ? { id: randomUUID(), source: 'max', kind: 'video', width: 320, height: 180, durationMs: 2_000, playbackPath: contentPath, posterState: 'pending', posterPath: null }
          : attachment) }
        : item)
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await openFeed(page)
    let mainFrameNavigations = 0
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameNavigations += 1 })
    const card = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
    const cardHandle = await card.elementHandle()
    if (!cardHandle) throw new Error('mixed MAX memory card is missing')
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-video-viewer-state="processing"]')).toBeVisible()
    await expect.poll(() => posterChecks, { timeout: 3_000 }).toBe(1)
    await expect(card.locator('video')).not.toHaveAttribute('poster', /^blob:/)
    expect(playbackRequests).toHaveLength(0)
    await expect.poll(() => posterChecks, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
    const video = card.locator('[data-carousel-active="true"] video')
    await expect(video).toHaveAttribute('poster', /^blob:/)
    const posterImage = card.locator('[data-carousel-active="true"] img[alt="Кадр видео"]')
    await expect(posterImage).toBeVisible()
    await expect.poll(() => posterImage.evaluate((image: HTMLImageElement) => ({ complete: image.complete, width: image.naturalWidth }))).toMatchObject({ complete: true, width: 1 })
    expect(posterMediaRequests.length).toBeGreaterThan(0)
    expect(posterMediaRequests.every((path) => path === posterPath)).toBe(true)
    expect(await video.evaluate((element: HTMLVideoElement) => ({ controls: element.controls, paused: element.paused, durationIsNaN: Number.isNaN(element.duration) }))).toEqual({ controls: true, paused: true, durationIsNaN: true })
    expect(playbackRequests).toHaveLength(0)
    expect(await card.evaluate((element, original) => element === original, cardHandle)).toBe(true)
    expect(mainFrameNavigations).toBe(0)
    let releaseFamilyHome!: () => void
    let markFamilyHomeStarted!: () => void
    const familyHomeHold = new Promise<void>((resolve) => { releaseFamilyHome = resolve })
    const familyHomeStarted = new Promise<void>((resolve) => { markFamilyHomeStarted = resolve })
    await page.route('**/api/v1/me/families*', async (route) => {
      markFamilyHomeStarted()
      await familyHomeHold
      await route.continue()
    })
    await page.reload()
    const refreshContinue = page.getByRole('button', { name: 'Продолжить' })
    await expect(refreshContinue).toBeVisible()
    await refreshContinue.click()
    await familyHomeStarted
    await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
    releaseFamilyHome()
    await page.getByRole('button', { name: 'Семья', exact: true }).click()
    await page.getByRole('button', { name: 'Лента', exact: true }).click()
    await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
    const reopenedCard = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
    const reopenedActiveSlide = await reopenedCard.locator('[data-carousel-dot][aria-current="step"]').getAttribute('data-carousel-dot')
    if (reopenedActiveSlide === '1') await reopenedCard.getByRole('button', { name: 'Следующий элемент' }).click()
    if (reopenedActiveSlide === '3') await reopenedCard.getByRole('button', { name: 'Предыдущий элемент' }).click()
    const reopenedPoster = reopenedCard.locator('[data-carousel-active="true"] img[alt="Кадр видео"]')
    await expect(reopenedPoster).toBeVisible()
    await expect.poll(() => posterChecks).toBeGreaterThanOrEqual(2)
    expect(posterMediaRequests.every((path) => path === posterPath)).toBe(true)
    const reopenedScreenshot = await reopenedCard.screenshot({ animations: 'disabled' })
    await test.info().attach('max-poster-ready-after-feed-family-feed.png', { body: reopenedScreenshot, contentType: 'image/png' })
    writeFileSync(resolve('e2e/.artifacts/max-poster-ready-after-family-navigation.png'), reopenedScreenshot)

    const reopenedPage = await page.context().newPage()
    try {
      await installMaxHost(reopenedPage, signedInitData(Number(subject), 'Лента E2E'))
      await installMaxAuthRoute(reopenedPage)
      await reopenedPage.route(`**${readinessPath}`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'processing', recheckable: true }) }))
      await reopenedPage.route(`**${posterReadinessPath}`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'ready', posterPath }) }))
      await reopenedPage.route('**/api/v1/families/*/memories**', async (route) => {
        if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.endsWith('/memories')) return route.continue()
        const response = await route.fetch()
        const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
        payload.items = payload.items.map((item) => item.body === 'Смешанное воспоминание E2E'
          ? { ...item, attachments: item.attachments.map((attachment, index) => index === 1
            ? { id: randomUUID(), source: 'max', kind: 'video', width: 320, height: 180, durationMs: 2_000, playbackPath: contentPath, posterState: 'ready', posterPath }
            : attachment) }
          : item)
        await route.fulfill({ response, body: JSON.stringify(payload) })
      })
      await reopenedPage.goto('/')
      const continueButton = reopenedPage.getByRole('button', { name: 'Продолжить' })
      const restoredFeed = reopenedPage.locator('[data-memoly-feed="true"]')
      const restoredScreen = await Promise.race([
        restoredFeed.waitFor({ state: 'visible' }).then(() => 'feed' as const),
        continueButton.waitFor({ state: 'visible' }).then(() => 'continue' as const),
      ])
      if (restoredScreen === 'continue') {
        await expect(continueButton).toBeEnabled()
        await continueButton.click()
        const familyHub = reopenedPage.getByRole('heading', { name: 'Мои семьи' })
        const restoredView = await Promise.race([
          restoredFeed.waitFor({ state: 'visible' }).then(() => 'feed' as const),
          familyHub.waitFor({ state: 'visible' }).then(() => 'family' as const),
        ])
        if (restoredView === 'family') await reopenedPage.locator('[data-slot="family-hub"] .family-hub-card').click()
      }
      await expect(restoredFeed).toBeVisible()
      const reopenedContextCard = reopenedPage.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
      await reopenedContextCard.scrollIntoViewIfNeeded()
      const activeSlide = await reopenedContextCard.locator('[data-carousel-dot][aria-current="step"]').getAttribute('data-carousel-dot')
      if (activeSlide === '1') await reopenedContextCard.getByRole('button', { name: 'Следующий элемент' }).click()
      if (activeSlide === '3') await reopenedContextCard.getByRole('button', { name: 'Предыдущий элемент' }).click()
      const reopenedContextPoster = reopenedContextCard.locator('[data-carousel-active="true"] img[alt="Кадр видео"]')
      await expect(reopenedContextPoster).toBeVisible()
      await expect.poll(() => reopenedContextPoster.evaluate((image: HTMLImageElement) => ({ complete: image.complete, width: image.naturalWidth }))).toMatchObject({ complete: true, width: 1 })
    } finally {
      await reopenedPage.close()
    }
  })

  test('offscreen MAX card waits to check readiness and shows confirmed unavailable distinctly', async ({ page }) => {
    const referenceId = randomUUID()
    const memoryId = randomUUID()
    const contentPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/content`
    const readinessPath = `/api/v1/families/${fixture.familyId}/media/max-videos/${referenceId}/readiness`
    let checks = 0
    let contentRequests = 0
    page.on('request', (request) => { if (request.url().includes(contentPath)) contentRequests += 1 })
    await page.route(`**${readinessPath}`, async (route) => {
      checks += 1
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'unavailable', recheckable: false }) })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.endsWith('/memories')) return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      const first = payload.items[0]
      if (!first) return route.fulfill({ response, body: JSON.stringify(payload) })
      payload.items.push({ ...first, id: memoryId, kind: 'video', body: 'Недоступное MAX видео E2E', attachments: [{ id: randomUUID(), source: 'max', kind: 'video', width: 320, height: 180, durationMs: 2_000, playbackPath: contentPath }] })
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await openFeed(page)
    const card = page.locator(`[data-memory-id="${memoryId}"]`)
    await expect(card).toHaveCount(1)
    await page.waitForTimeout(750)
    expect(checks).toBe(0)
    await card.scrollIntoViewIfNeeded()
    await expect(card.locator('[data-video-viewer-state="unavailable"]')).toBeVisible()
    await expect(card.getByText('Видео недоступно')).toBeVisible()
    await expect(card.getByText('Не удалось загрузить видео')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Проверить готовность' })).toHaveCount(0)
    expect(checks).toBe(1)
    expect(contentRequests).toBe(0)
  })

  test('photo album swipes in Feed and opens the selected photo without losing its position', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const card = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Фотоальбом E2E' })
    await card.scrollIntoViewIfNeeded()
    const viewport = card.locator('.memoly-mixed-viewport')
    await expect(viewport).toHaveAttribute('data-media-stage', 'feed')
    await expect(card.locator('.memoly-mixed-slide')).toHaveCount(2)
    await expect(card.locator('[data-carousel-dot]')).toHaveCount(2)
    const initialHeight = await viewport.evaluate((element) => element.getBoundingClientRect().height)
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error('photo carousel viewport is missing')
    const touch = await page.context().newCDPSession(page)
    const y = bounds.y + bounds.height / 2
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width * .8, y, id: 1 }] })
    for (let step = 1; step <= 8; step += 1) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width * (.8 - .6 * step / 8), y, id: 1 }] })
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await touch.detach()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    await expect(card.locator('[data-carousel-active="true"]')).toHaveAttribute('aria-label', '2 из 2, фото')
    await expect.poll(() => card.evaluate((element) => {
      const viewportBounds = element.querySelector('.memoly-mixed-viewport')?.getBoundingClientRect()
      const activeBounds = element.querySelector('[data-carousel-active="true"]')?.getBoundingClientRect()
      return viewportBounds && activeBounds ? Math.abs(viewportBounds.left - activeBounds.left) : Number.POSITIVE_INFINITY
    })).toBeLessThan(2)
    expect(await viewport.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(initialHeight, 1)
    await card.screenshot({ path: resolve('e2e/.artifacts/car1-photo-album-slide-2.png'), animations: 'disabled' })
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await card.scrollIntoViewIfNeeded()
      const layout = await viewport.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return { ratio: bounds.width / bounds.height, pageWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth }
      })
      expect(layout.ratio).toBeCloseTo(4 / 5, 2)
      expect(layout.pageWidth).toBeLessThanOrEqual(width)
      expect(layout.viewportWidth).toBe(width)
      await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    }
    const opener = card.getByRole('button', { name: 'Открыть фото' })
    await opener.click()
    await expect(page.locator('.pswp__counter')).toContainText('2 / 2')
    await page.locator('.pswp__button--close').click()
    await expect(opener).toBeFocused()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
  })

  test('five-photo Memory swipes through every Feed slide and opens the selected photo', async ({ page }) => {
    const keys = Array.from({ length: 5 }, (_, index) => `media-display/${randomUUID()}-five-photo-${index}.png`)
    fixture.objectKeys.push(...keys)
    for (const key of keys) await store(key, pngImage.buffer, 'image/png')
    const assets = await Promise.all(keys.map((key) => createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })))
    let memoryId: string | null = null
    try {
      const memory = await createMemoryWithMedia({ familyId: fixture.familyId, childId: fixture.childId, userId: fixture.ownerUserId, kind: 'photo', body: 'Пять фотографий E2E', occurredAt: new Date(), assets })
      memoryId = memory.id
      await page.setViewportSize({ width: 390, height: 844 })
      await page.reload()
      await openFeed(page)
      const card = page.locator(`[data-memory-id="${memory.id}"]`)
      await card.scrollIntoViewIfNeeded()
      const viewport = card.locator('.memoly-mixed-viewport')
      await expect(card.locator('.memoly-mixed-slide')).toHaveCount(5)
      await expect(card.locator('[data-carousel-dot]')).toHaveCount(5)
      const initialStage = await viewport.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      expect(initialStage.width / initialStage.height).toBeCloseTo(4 / 5, 2)
      const touch = await page.context().newCDPSession(page)
      try {
        for (let next = 2; next <= 5; next += 1) {
          await card.scrollIntoViewIfNeeded()
          const bounds = await viewport.boundingBox()
          if (!bounds) throw new Error('five-photo carousel viewport is missing')
          const y = bounds.y + bounds.height / 2
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width * .8, y, id: 1 }] })
          for (let step = 1; step <= 8; step += 1) {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + bounds.width * (.8 - .6 * step / 8), y, id: 1 }] })
          }
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await expect(card.locator(`[data-carousel-dot="${next}"]`)).toHaveAttribute('aria-current', 'step')
          await expect(card.locator('[data-carousel-active="true"]')).toHaveAttribute('aria-label', `${next} из 5, фото`)
          await expect.poll(() => card.evaluate((element) => {
            const stage = element.querySelector('.memoly-mixed-viewport')?.getBoundingClientRect()
            const active = element.querySelector('[data-carousel-active="true"]')?.getBoundingClientRect()
            return stage && active ? Math.abs(stage.left - active.left) : Number.POSITIVE_INFINITY
          })).toBeLessThan(2)
          const height = await viewport.evaluate((element) => element.getBoundingClientRect().height)
          expect(height).toBeCloseTo(initialStage.height, 1)
        }
      } finally {
        await touch.detach()
      }
      const opener = card.getByRole('button', { name: 'Открыть фото' })
      await opener.click()
      await expect(page.locator('.pswp__counter')).toContainText('5 / 5')
      await page.locator('.pswp__button--close').click()
      await expect(opener).toBeFocused()
      await expect(card.locator('[data-carousel-dot="5"]')).toHaveAttribute('aria-current', 'step')
    } finally {
      if (memoryId) await prisma.memory.deleteMany({ where: { id: memoryId } })
      await prisma.mediaAsset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } })
    }
  })

  test('photo album fetch failure restores focus and retries the selected slide', async ({ page }) => {
    await openFeed(page)
    const album = await prisma.memory.findFirst({ where: { familyId: fixture.familyId, body: 'Фотоальбом E2E' }, include: { media: { orderBy: { position: 'asc' } } } })
    const secondMediaId = album?.media[1]?.mediaId
    if (!secondMediaId) throw new Error('two-photo album fixture is missing its second attachment')
    const card = page.locator(`[data-memory-id="${album.id}"]`)
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    await expect(card.locator('[data-carousel-position="2"] [data-seen-ready="true"]')).toHaveCount(1)
    let failedOnce = false
    await page.route(`**/media/${secondMediaId}/content?variant=display`, async (route) => {
      if (failedOnce) return route.continue()
      failedOnce = true
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic photo fetch failure' } }) })
    })
    const opener = card.getByRole('button', { name: 'Открыть фото' })
    await opener.scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate(() => window.scrollY)
    await opener.click()
    await expect(card.getByRole('alert')).toHaveText('Не удалось открыть фото. Попробуйте ещё раз.')
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
    await opener.click()
    await expect(page.locator('.pswp__counter')).toContainText('2 / 2')
    await expect(card.getByRole('alert')).toHaveCount(0)
    await page.locator('.pswp__button--close').click()
    await expect(opener).toBeFocused()
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    expect(failedOnce).toBe(true)
  })

  test('opening a photo album before Feed dwell marks the same Memory seen in fullscreen', async ({ page }) => {
    const keys = [0, 1].map((index) => `media-display/${randomUUID()}-album-seen-${index}.png`)
    fixture.objectKeys.push(...keys)
    for (const key of keys) await store(key, pngImage.buffer, 'image/png')
    const assets = await Promise.all(keys.map((key) => createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })))
    let memoryId: string | null = null
    let seenRequests = 0
    let seenWhileFullscreen = false
    try {
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 1n } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
      })
      const memory = await prisma.memory.create({ data: {
        familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
        kind: 'photo', body: 'Непросмотренный фотоальбом E2E', occurredAt: new Date(),
        firstPublishedAt: new Date(), firstPublishedOrdinal: 1n,
        media: { create: assets.map((asset, position) => ({ mediaId: asset.id, position })) },
      } })
      memoryId = memory.id
      await page.route('**/memories/seen', async (route) => {
        seenRequests += 1
        seenWhileFullscreen = seenWhileFullscreen || await page.locator('.pswp--open').count() > 0
        await route.continue()
      })
      await page.reload()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /1 непросмотренных воспоминаний/)
      await page.locator('.family-hub-card').click()
      await page.getByRole('button', { name: 'Показать 1 непросмотренное воспоминание' }).click()
      const card = page.locator(`[data-memory-id="${memory.id}"]`)
      await expect(card.getByRole('button', { name: 'Открыть фото' })).toBeVisible()
      expect(seenRequests).toBe(0)
      await card.getByRole('button', { name: 'Открыть фото' }).click()
      await expect(page.locator('.pswp--open')).toBeVisible()
      await expect.poll(() => seenRequests).toBe(1)
      expect(seenWhileFullscreen).toBe(true)
      await expect.poll(() => prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: memory.id } })).toBe(1)
      await page.locator('.pswp__button--close').click()
    } finally {
      if (memoryId) await prisma.memory.deleteMany({ where: { id: memoryId } })
      await prisma.mediaAsset.deleteMany({ where: { id: { in: assets.map((asset) => asset.id) } } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: null, publicationOrdinal: 0n } })
      await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: null } })
    }
  })

  test('mixed carousel accepts touch swipe while vertical touch still scrolls the feed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const card = page.locator('[data-memory-kind="media"]')
    await card.scrollIntoViewIfNeeded()
    const viewport = card.locator('.memoly-mixed-viewport')
    const bounds = await viewport.boundingBox()
    if (!bounds) throw new Error('mixed carousel viewport is missing')
    const session = await page.context().newCDPSession(page)
    const touch = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
      for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }] })
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const y = bounds.y + Math.min(bounds.height / 2, 80)
    await touch({ x: bounds.x + bounds.width * .8, y }, { x: bounds.x + bounds.width * .2, y })
    await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
    const before = await page.evaluate(() => window.scrollY)
    await touch({ x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height - 30, 220) }, { x: bounds.x + bounds.width / 2, y: bounds.y + 30 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
    await session.detach()
  })

  test('streams voice and legacy video on demand after legacy metadata, seeks with Range/206, and pauses on hide', async ({ page }) => {
    const responses: Array<{ range: string | null; status: number; url: string }> = []
    page.on('response', (response) => {
      if (!response.url().includes('/media/') || !response.url().includes('variant=playback')) return
      responses.push({
        range: response.request().headers()['range'] ?? null,
        status: response.status(),
        url: response.url(),
      })
    })
    await openFeed(page)

    await page.waitForTimeout(500)
    // The legacy player has always used preload="metadata". It may fetch a Range
    // before play; inactive mixed video and voice must remain untouched.
    expect(responses.every((response) => response.url.includes(fixture.legacyVideoId))).toBe(true)
    expect(responses.some((response) => response.url.includes(fixture.mixedVideoId) || response.url.includes(fixture.voiceId))).toBe(false)

    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await expect(voice).toHaveAttribute('src', /^\/api\//)
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => responses.some((response) => response.url.includes(fixture.voiceId) && response.range && response.status === 206)).toBe(true)
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)

    const videoCard = page.locator('[data-memory-id]').filter({ hasText: 'Legacy video E2E' })
    await videoCard.getByRole('button', { name: 'Воспроизвести видео' }).click()
    const legacyVideo = videoCard.locator('video')
    await expect.poll(() => legacyVideo.evaluate((element: HTMLVideoElement) => !element.paused && element.currentTime > 0)).toBe(true)
    expect(responses.some((response) => response.url.includes(fixture.legacyVideoId) && response.range && response.status === 206)).toBe(true)
    await videoCard.getByLabel('Позиция видео').fill('2')
    await expect.poll(() => legacyVideo.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(1.9)
    await expect.poll(() => responses.every((response) => response.status === 206)).toBe(true)
  })

  test('pending private video becomes ready in place after its Memory detail is polled', async ({ page }) => {
    let memoryId: string | null = null
    let detailReads = 0
    let listReads = 0
    let listReady = false
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') return route.fallback()
      if (url.pathname.endsWith('/memories')) {
        listReads += 1
        const response = await route.fetch()
        const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
        payload.items = payload.items.map((item) => {
          if (item.body !== 'Legacy video E2E') return item
          memoryId = String(item.id)
          return listReady
            ? { ...item, likes: { ...(item.likes as Record<string, unknown>), count: 7 } }
            : { ...item, attachments: item.attachments.map((attachment) => ({ ...attachment, renditionStatus: 'pending', playbackPath: null })) }
        })
        return route.fulfill({ response, body: JSON.stringify(payload) })
      }
      if (!memoryId || !url.pathname.endsWith(`/memories/${memoryId}`)) return route.continue()
      detailReads += 1
      const response = await route.fetch()
      if (detailReads > 1) return route.fulfill({ response })
      const detail = await response.json() as E2EMemoryFixture
      detail.attachments = detail.attachments.map((attachment) => ({ ...attachment, renditionStatus: 'pending', playbackPath: null }))
      return route.fulfill({ response, body: JSON.stringify(detail) })
    })

    await openFeed(page)
    const cards = page.locator('#root [data-memoly-feed] [data-memory-id]')
    const card = cards.filter({ hasText: 'Legacy video E2E' })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('Подготавливаем видео')).toBeVisible()
    await page.waitForTimeout(750)
    expect(detailReads).toBe(0)
    await card.scrollIntoViewIfNeeded()
    await expect.poll(() => detailReads).toBeGreaterThanOrEqual(1)
    const cardHandle = await card.elementHandle()
    const idsBefore = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-memory-id')))
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Подробнее' }).click()
    const viewer = page.getByRole('dialog')
    await expect(viewer.getByText('Подготавливаем видео')).toBeVisible()

    await expect.poll(() => detailReads, { timeout: 12_000 }).toBeGreaterThanOrEqual(2)
    await expect(card.getByText('Подготавливаем видео')).toHaveCount(0)
    await expect(card.locator('video')).toHaveAttribute('src', new RegExp(`/media/${fixture.legacyVideoId}/content\\?variant=playback`))
    await expect(viewer.locator('video')).toHaveAttribute('src', new RegExp(`/media/${fixture.legacyVideoId}/content\\?variant=playback`))
    listReady = true
    const priorListReads = listReads
    await card.locator('button[aria-label$="сердечко"]').evaluate((button) => (button as HTMLButtonElement).click())
    await expect.poll(() => listReads).toBeGreaterThan(priorListReads)
    await expect(card.locator('button[aria-label$="сердечко"]')).toContainText('7')
    await expect(viewer.locator('video')).toHaveAttribute('src', new RegExp(`/media/${fixture.legacyVideoId}/content\\?variant=playback`))
    await expect(viewer.getByText('Подготавливаем видео')).toHaveCount(0)
    expect(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-memory-id')))).toEqual(idsBefore)
    expect(await card.evaluate((element, original) => element === original, cardHandle)).toBe(true)
    await expect(card.locator('.ml-video-row button').first()).toBeEnabled()
  })

  test('replenishes three nearby polling slots after ready and lets a fifth be checked manually', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 3000 })
    let pending: E2EMemoryFixture[] = []
    const detailCalls: string[] = []
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') return route.fallback()
      if (url.pathname.endsWith('/memories')) {
        const response = await route.fetch()
        const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
        const original = payload.items.find((item) => item.body === 'Legacy video E2E')
        if (!original) return route.fulfill({ response, body: JSON.stringify(payload) })
        if (pending.length === 0) pending = Array.from({ length: 5 }, (_, index) => ({
          ...original,
          id: randomUUID(),
          body: `Ожидающее видео ${index + 1}`,
          attachments: original.attachments.map((attachment) => ({ ...attachment, renditionStatus: 'pending', playbackPath: null })),
        }))
        payload.items = [...pending, ...payload.items]
        return route.fulfill({ response, body: JSON.stringify(payload) })
      }
      const match = pending.find((item) => url.pathname.endsWith(`/memories/${item.id}`))
      if (!match) return route.continue()
      detailCalls.push(String(match.id))
      const ready = String(match.id) === String(pending[0]?.id) || String(match.id) === String(pending[4]?.id)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(ready
        ? { ...match, attachments: match.attachments.map((attachment) => ({ ...attachment, renditionStatus: 'ready', playbackPath: `/api/v1/families/${fixture.familyId}/media/${fixture.legacyVideoId}/content?variant=playback` })) }
        : match) })
    })

    await openFeed(page)
    await expect(page.locator('[data-memory-id]').filter({ hasText: 'Ожидающее видео 5' })).toHaveCount(1)
    await expect.poll(() => detailCalls.includes(String(pending[0]?.id))).toBe(true)
    await expect.poll(() => detailCalls.includes(String(pending[3]?.id))).toBe(true)
    expect(detailCalls).not.toContain(String(pending[4]?.id))
    const fifth = page.locator('[data-memory-id]').filter({ hasText: 'Ожидающее видео 5' })
    await fifth.getByRole('button', { name: 'Проверить готовность' }).click()
    await expect.poll(() => detailCalls.filter((id) => id === pending[4]?.id).length).toBe(1)
    await expect(fifth.getByText('Подготавливаем видео')).toHaveCount(0)
    await expect(fifth.locator('video')).toHaveAttribute('src', new RegExp(`/media/${fixture.legacyVideoId}/content\\?variant=playback`))
  })

  test('opens Telegram-only video through the guarded opaque hand-off', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-id]').filter({ hasText: 'Telegram video E2E' })
    await expect(card.locator('[data-slot="telegram-video-play-control"]')).toHaveCSS('z-index', '10')
    await card.getByRole('button', { name: 'Смотреть видео в Telegram' }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)).toMatch(/^https:\/\/t\.me\/OurMemoriesDevBot\?start=watch_[A-Za-z0-9_-]{32}$/)
    const deepLink = await page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)
    expect(deepLink).not.toContain('synthetic-file-id')
  })

  test('captures memory actions against the canonical sheet at mobile width', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })
    await page.reload()
    await openFeed(page)
    const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).first()
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('[data-slot="memoly-bottom-sheet-handle"]')).toHaveCount(1)
    await expect(page.locator('[data-slot="drawer-handle"]')).toHaveCount(0)
    await expect(page.locator('.memoly-memory-action')).toHaveCount(3)
    for (const label of ['Подробнее', 'Открыть публикацию целиком', 'Редактировать', 'Изменить подпись или дату', 'Удалить воспоминание', 'Удалить из семейной ленты']) {
      await expect(page.locator('.memoly-memory-actions')).toContainText(label)
    }
    await expect(page.locator('.memoly-memory-actions > [data-slot="drawer-title"]')).toHaveClass(/sr-only/)
    await page.screenshot({ path: resolve('e2e/.artifacts/memory-actions-after-390.png'), animations: 'disabled' })

    const canonical = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    const referenceUrl = pathToFileURL(resolve('../docs/memoly-final-functional-state-pack.html')).href
    await canonical.goto(`${referenceUrl}#memoryActions`)
    await expect(canonical.locator('#memoryActions .ml-sheet-row')).toHaveCount(2)
    await expect(canonical.locator('#memoryActions .state-action-row')).toHaveCount(1)
    await canonical.screenshot({ path: resolve('e2e/.artifacts/memory-actions-canonical-390.png'), animations: 'disabled' })
    const sheetGeometry = await Promise.all([
      page.locator('[data-memoly-bottom-sheet="true"]'),
      canonical.locator('#memoryActions .ml-sheet-panel'),
    ].map((sheet) => sheet.evaluate((panel) => {
      const rect = panel.getBoundingClientRect()
      const row = panel.querySelector('.memoly-memory-action, .ml-sheet-row')?.getBoundingClientRect()
      const handle = panel.querySelector('[data-slot="memoly-bottom-sheet-handle"], .ml-sheet-handle')?.getBoundingClientRect()
      return { top: rect.top, height: rect.height, rowTop: row?.top, rowHeight: row?.height, handleTop: handle?.top, handleHeight: handle?.height }
    })))
    for (const key of ['top', 'height', 'rowTop', 'rowHeight', 'handleTop', 'handleHeight'] as const) {
      expect(Math.abs((sheetGeometry[0]![key] ?? 0) - (sheetGeometry[1]![key] ?? 0))).toBeLessThanOrEqual(3)
    }
    const initialTheme = await page.locator('html').getAttribute('data-memoly-theme')
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), theme)
      await page.screenshot({ path: resolve(`e2e/.artifacts/memory-actions-${theme}-390.png`), animations: 'disabled' })
      await canonical.locator(`#theme${theme[0]!.toUpperCase()}${theme.slice(1)}`).evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) })
      await canonical.screenshot({ path: resolve(`e2e/.artifacts/memory-actions-canonical-${theme}-390.png`), animations: 'disabled' })
    }
    await canonical.close()
    if (initialTheme) await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), initialTheme)
    await triggerTelegramBack(page)
    await expect(card.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'viewer' },
    })
  })

  test('keeps the exact memory in delete spotlight through cancel, failure, and success', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })
    await page.reload()
    await openFeed(page)
    const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Заметка E2E 42' })
    for (let pageIndex = 0; pageIndex < 4 && await card.count() === 0; pageIndex += 1) {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await page.waitForTimeout(250)
    }
    await card.scrollIntoViewIfNeeded()
    const selectedId = await card.getAttribute('data-memory-id')
    expect(selectedId).toBeTruthy()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    const spotlight = page.getByRole('alertdialog')
    await expect(spotlight).toContainText('Удалить воспоминание?')
    await expect(page.locator(`[data-memory-id="${selectedId}"]`)).toHaveCount(1)
    await expect(card).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-delete-390.png'), animations: 'disabled' })
    await page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()

    await page.route('**/api/v1/families/*/memories/*', (route) => {
      if (route.request().method() !== 'DELETE') return route.continue()
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic delete failure' } }),
      })
    })
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    await page.getByRole('button', { name: 'Удалить' }).click()
    await expect(card).toBeVisible()
    await expect(page.locator(`[data-memory-id="${selectedId}"]`)).toHaveCount(1)
    await expect(spotlight.getByRole('alert')).toContainText('Не удалось удалить воспоминание. Попробуйте ещё раз.')
    await page.unroute('**/api/v1/families/*/memories/*')

    await page.getByRole('button', { name: 'Удалить' }).click()
    await expect(card).toHaveCount(0)
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'viewer' },
    })
  })

  test('captures loading, empty, error, and retry states at 390px', async ({ page }) => {
    let mode: 'empty' | 'error' = 'empty'
    let releaseLoading!: () => void
    const loading = new Promise<void>((resolveLoading) => { releaseLoading = resolveLoading })
    let loadingReleased = false
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      if (!loadingReleased) await loading
      if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic visual failure' } }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.locator('[data-slot="feed-skeleton"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-loading-390.png'), animations: 'disabled' })
    loadingReleased = true
    releaseLoading()
    await expect(page.locator('[data-slot="feed-empty"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-empty-390.png'), animations: 'disabled' })
    mode = 'error'
    await page.reload()
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.locator('[data-slot="inline-error"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-error-390.png'), animations: 'disabled' })
    mode = 'empty'
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.locator('[data-slot="feed-empty"]')).toBeVisible()
  })

  test('compares the canonical photo card and unread-action geometry with deterministic visual data', async ({ page }) => {
    const canonical = readFileSync(resolve('../docs/memoly-final-functional-state-pack.html'))
    expect(createHash('sha256').update(canonical).digest('hex')).toBe('180f8c9b6e60369513cffd5eb9dbb3cb3397649407df996dcf907ab0fa38c5b4')
    const imageBase64 = canonical.toString('utf8').match(/class="media photo" src="data:image\/jpeg;base64,([^"]+)"/)?.[1]
    expect(imageBase64).toBeTruthy()
    const image = Buffer.from(imageBase64!, 'base64')
    const key = `media-display/${randomUUID()}-canonical.jpg`
    fixture.objectKeys.push(key)
    await store(key, image, 'image/jpeg')
    const asset = await createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key, bytes: image, mime: 'image/jpeg', width: 790, height: 450 })
    await prisma.user.update({ where: { id: fixture.ownerUserId }, data: { displayName: 'Мама' } })
    await prisma.child.update({ where: { id: fixture.childId }, data: { displayName: 'София', birthDate: new Date('2024-05-25T00:00:00.000Z') } })
    const priorUnreadState = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId }, select: { unreadTrackingActivatedAt: true, publicationOrdinal: true } })
    const priorMemberUnreadState = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, select: { unreadBaselineOrdinal: true } })
    await prisma.family.update({ where: { id: fixture.familyId }, data: { publicationOrdinal: 1n } })
    const body = 'Моё солнышко утром ☀️\nКак же ты любишь своего зайку 🤍'
    const memory = await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId, kind: 'photo', body,
      occurredAt: new Date(Date.now() + 30_000), firstPublishedAt: new Date(), firstPublishedOrdinal: 1n,
      media: { create: [{ mediaId: asset.id, position: 0 }] },
    } })
    try {
    await prisma.$transaction(async (tx) => {
      await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 1n } })
      await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      payload.items = payload.items.filter((item) => item.id === memory.id).map((item) => ({ ...item, occurredAt: '2026-09-25T07:24:00.000Z' }))
      payload.nextCursor = null
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.clock.setFixedTime(new Date('2026-09-25T07:30:00.000Z'))
    await page.reload()
    await page.locator('[data-slot="family-hub"] .family-hub-card').click()
    await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
    await expect(page.locator(`[data-memory-id="${memory.id}"]`)).toBeVisible()
    await expect(page.locator(`[data-memory-id="${memory.id}"] .memory-child-tag`)).toHaveCount(0)
    const reactionSummary = page.locator(`[data-memory-id="${memory.id}"] [data-slot="memory-reactions"]`)
    await expect(reactionSummary).toHaveCount(0)

    const geometry: Record<string, unknown> = {}
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready)
      await page.locator(`[data-memory-id="${memory.id}"] img`).first().evaluate((image: HTMLImageElement) => image.decode())
      await expect(page.locator('.filters-wrap .filter')).toHaveCount(0)
      const unreadControl = page.locator('.feed-unread-action')
      await expect(unreadControl).toBeVisible()
      const controlGeometry = await unreadControl.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { width: rect.width, height: rect.height, viewportWidth: document.documentElement.clientWidth, background: style.backgroundImage, shadow: style.boxShadow, fontFamily: style.fontFamily }
      })
      expect(controlGeometry.width).toBeLessThan(controlGeometry.viewportWidth)
      expect(controlGeometry.height).toBeGreaterThanOrEqual(44)
      expect(controlGeometry.background).toBe('none')
      expect(controlGeometry.shadow).toBe('none')
      expect(controlGeometry.fontFamily).toMatch(/system-ui/)
      const metrics = await page.evaluate(() => {
        const measure = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!
          const rect = element.getBoundingClientRect()
          const css = getComputedStyle(element)
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, marginTop: css.marginTop, marginBottom: css.marginBottom, padding: css.padding, gap: css.gap, overflowX: css.overflowX, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
        }
        return { header: measure('[data-child-header-mode="feed"]'), app: measure('[data-slot="feed-scroll"]'), unreadControl: measure('.feed-unread-action'), card: measure('.memory-card'), cardHeader: measure('.memory-card .memory-header'), media: measure('.memory-card .memory-media-slot'), caption: measure('.memory-card .caption') }
      })
      geometry[name] = metrics
      await page.screenshot({ path: resolve(`e2e/.artifacts/agent-b-react-comparable-${name}.png`), fullPage: true, animations: 'disabled' })
      await page.locator(`[data-memory-id="${memory.id}"]`).screenshot({ path: resolve(`e2e/.artifacts/agent-b-react-card-${name}.png`), animations: 'disabled' })
    }
    for (const [width, height] of [[320, 568], [390, 844], [430, 932], [480, 844]]) {
      await page.setViewportSize({ width, height })
      await capture(String(width))
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await selectTheme(page, theme)
      await page.getByRole('button', { name: 'Лента' }).click()
      await expect(page.locator(`[data-memory-id="${memory.id}"]`)).toBeVisible()
      await capture(`${theme}-390`)
    }
    const reactionCard = page.locator(`[data-memory-id="${memory.id}"]`)
    await reactionCard.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('button', { name: 'Сердце', exact: true }).click()
    await expect(reactionSummary.locator('[data-reaction="heart"]')).toContainText('1')
    await reactionCard.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('button', { name: 'Сердце, выбрана', exact: true }).click()
    await expect(reactionSummary).toHaveCount(0)
    writeFileSync(resolve('e2e/.artifacts/agent-b-react-metrics.json'), JSON.stringify(geometry, null, 2))
    } finally {
      await prisma.memory.deleteMany({ where: { id: memory.id } })
      await prisma.mediaAsset.deleteMany({ where: { id: asset.id } })
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: priorUnreadState })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: priorMemberUnreadState })
      })
    }
  })

  test('reaction picker opens only on a hold, survives release, and selects in a separate tap', async ({ page }) => {
    await openFeed(page)
    const image = page.locator('.memory-media-slot img').first()
    const card = image.locator('xpath=ancestor::article[@data-memory-id]')
    await expect(card).toBeVisible()
    await expect(image).toBeVisible()
    await expect(card.locator('[data-slot="memory-reactions"]')).toHaveCount(0)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-none.png'), animations: 'disabled' })
    let current: string | null = null
    let writes = 0
    const payloads: Array<string | null> = []
    const reactionRequests: Array<{ url: string; method: string; body: string | null }> = []
    const counts: Record<string, number> = { heart: 12_345, love: 2_345, touched: 345, wow: 456, clap: 567 }
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/reaction')) reactionRequests.push({ url: request.url(), method: request.method(), body: request.postData() })
    })
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => {
      writes += 1
      const payload = route.request().postDataJSON() as { reaction: string | null }
      payloads.push(payload.reaction)
      if (current) counts[current] = Math.max(0, (counts[current] ?? 0) - 1)
      if (current && counts[current] === 0) delete counts[current]
      current = payload.reaction
      if (current) counts[current] = (counts[current] ?? 0) + 1
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reactionCounts: counts, currentUserReaction: current, likes: { count: Object.values(counts).reduce((total, count) => total + count, 0), likedByMe: current === 'heart' } }) })
    })
    const memoryId = await card.getAttribute('data-memory-id')
    const holdImage = async (point = { x: 0.5, y: 0.5 }) => {
      await image.scrollIntoViewIfNeeded()
      const bounds = await image.boundingBox()
      expect(bounds).not.toBeNull()
      expect(await card.getAttribute('data-memory-id')).toBe(memoryId)
      const x = bounds!.x + bounds!.width * point.x
      const y = bounds!.y + bounds!.height * point.y
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.waitForTimeout(550)
      await expect(page.locator('.reaction-picker')).toBeVisible()
      await page.mouse.up()
    }
    await holdImage()
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    expect(writes).toBe(0)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-open.png'), animations: 'disabled' })
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Смех' }).click()
    await expect(card.locator('[data-reaction="laugh"]')).toContainText('1')
    await page.waitForTimeout(1_000)
    const postClickState = await page.evaluate(() => ({
      pickerOpen: Boolean(document.querySelector('[role="group"][aria-label="Реакции"]')),
      activeMemoryId: (document.activeElement?.closest('[data-memory-id]') as HTMLElement | null)?.dataset.memoryId ?? null,
      visibleResult: Array.from(document.querySelectorAll('[data-reaction]')).map((element) => ({ value: element.getAttribute('data-reaction'), text: element.textContent })),
      viewerOpen: Boolean(document.querySelector('.pswp')),
    }))
    expect(writes, JSON.stringify({ reactionRequests, postClickState })).toBe(1)
    await card.locator('[data-slot="memory-reactions"]').scrollIntoViewIfNeeded()
    const resultTypography = await card.locator('[data-reaction="laugh"]').evaluate((result) => ({
      background: getComputedStyle(result).backgroundColor,
      borderWidth: getComputedStyle(result).borderWidth,
      radius: getComputedStyle(result).borderRadius,
      emojiSize: getComputedStyle(result.querySelector('.reaction-result-emoji')!).fontSize,
      countSize: getComputedStyle(result.querySelector('.reaction-result-count')!).fontSize,
    }))
    expect(resultTypography).toEqual({ background: 'rgba(0, 0, 0, 0)', borderWidth: '0px', radius: '0px', emojiSize: '21px', countSize: '14px' })
    await expect(card.locator('[data-reaction]')).toHaveCount(6)
    const passiveSummary = card.locator('[data-slot="memory-reactions"]')
    await passiveSummary.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const passiveSummaryBounds = await passiveSummary.boundingBox()
    const passiveNavBounds = await page.getByTestId('bottom-navigation').boundingBox()
    expect(passiveSummaryBounds).not.toBeNull()
    expect(passiveNavBounds).not.toBeNull()
    expect(passiveSummaryBounds!.y).toBeGreaterThanOrEqual(0)
    expect(passiveSummaryBounds!.y + passiveSummaryBounds!.height).toBeLessThanOrEqual(passiveNavBounds!.y)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-passive-result.png'), animations: 'disabled' })
    expect(await card.getAttribute('data-memory-id')).toBe(memoryId)
    expect(payloads).toEqual(['laugh'])
    expect(writes).toBe(1)
    await card.locator('[data-reaction="laugh"]').click()
    expect(writes).toBe(1)
    await holdImage()
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Смех' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Смех, выбрана' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Смех' }).click()
    await expect.poll(() => writes).toBe(2)
    expect(payloads).toEqual(['laugh', null])
    await expect(card.locator('[data-slot="memory-reactions"]')).toHaveCount(1)
    await expect(card.locator('[data-reaction]')).toHaveCount(5)
    expect(writes).toBe(2)
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport)
    }
    await page.setViewportSize({ width: 320, height: 844 })
    await page.locator('[data-slot="feed-scroll"]').evaluate((element) => { element.scrollTop += 120 })
    await holdImage()
    const picker = page.getByRole('group', { name: 'Реакции', exact: true })
    await expect(picker).toBeVisible()
    const pickerBounds = await picker.boundingBox()
    expect(pickerBounds).not.toBeNull()
    expect(pickerBounds!.x).toBeGreaterThanOrEqual(0)
    expect(pickerBounds!.x + pickerBounds!.width).toBeLessThanOrEqual(320)
    const navBounds = await page.getByTestId('bottom-navigation').boundingBox()
    expect(navBounds).not.toBeNull()
    expect(pickerBounds!.y + pickerBounds!.height).toBeLessThanOrEqual(navBounds!.y)
    await expect(picker.getByRole('button')).toHaveCount(6)
    await expect.poll(async () => {
      const heights = await picker.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))
      return heights.length === 6 && heights.every((height) => height >= 44)
    }).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-320.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await holdImage({ x: 0.98, y: 0.03 })
    const edgePicker = await picker.boundingBox()
    expect(edgePicker).not.toBeNull()
    expect(edgePicker!.x).toBeGreaterThanOrEqual(0)
    expect(edgePicker!.x + edgePicker!.width).toBeLessThanOrEqual(320)
    expect(edgePicker!.y).toBeGreaterThanOrEqual(0)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-top-side.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 320, height: 568 })
    await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="bottom-navigation"]')!.getBoundingClientRect()
      const img = document.querySelector('.memory-media-slot img')!.getBoundingClientRect()
      const image = document.querySelector('.memory-media-slot img')!
      const ancestors: HTMLElement[] = []
      for (let parent = image.parentElement; parent; parent = parent.parentElement) ancestors.push(parent)
      const documentScroller = document.scrollingElement as HTMLElement | null
      const scrollTarget = [...ancestors, ...(documentScroller ? [documentScroller] : [])].find((element) => element.scrollHeight > element.clientHeight + 1)
      if (!scrollTarget) throw new Error('No scrollable ancestor can position the image above bottom navigation')
      scrollTarget.scrollTop += img.bottom - (nav.top - 6)
    })
    await expect.poll(async () => {
      const imageBounds = await image.boundingBox()
      const navigationBounds = await page.getByTestId('bottom-navigation').boundingBox()
      return imageBounds && navigationBounds ? Math.abs(imageBounds.y + imageBounds.height - (navigationBounds.y - 6)) < 2 : false
    }).toBe(true)
    const lowerImageBounds = await image.boundingBox()
    const lowerNavBounds = await page.getByTestId('bottom-navigation').boundingBox()
    expect(lowerImageBounds).not.toBeNull()
    expect(lowerNavBounds).not.toBeNull()
    const lowerPoint = { x: lowerImageBounds!.x + lowerImageBounds!.width / 2, y: lowerNavBounds!.y - 12 }
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.memory-media-slot img')), lowerPoint)).toBe(true)
    await page.mouse.move(lowerPoint.x, lowerPoint.y)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(picker).toBeVisible()
    const lowerPickerBounds = await picker.boundingBox()
    const settledNavBounds = await page.getByTestId('bottom-navigation').boundingBox()
    expect(lowerPickerBounds).not.toBeNull()
    expect(settledNavBounds).not.toBeNull()
    expect(lowerPickerBounds!.y + lowerPickerBounds!.height).toBeLessThanOrEqual(settledNavBounds!.y)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-bottom-nav.png'), animations: 'disabled' })
    await page.mouse.up()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    const feedSurface = page.locator('[data-memoly-feed]')
    const browserSafeAreaDefaults = await feedSurface.evaluate((surface) => {
      const style = getComputedStyle(surface)
      return ['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(`--reaction-safe-inset-${side}`).trim())
    })
    expect(browserSafeAreaDefaults).toEqual(['0px', '0px', '0px', '0px'])
    await feedSurface.evaluate((surface) => {
      surface.style.setProperty('--host-inset-top', '44px')
      surface.style.setProperty('--host-inset-right', '20px')
      surface.style.setProperty('--host-inset-bottom', '34px')
      surface.style.setProperty('--host-inset-left', '16px')
    })
    const hostInsets = await feedSurface.evaluate((surface) => {
      const style = getComputedStyle(surface)
      return ['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(`--host-inset-${side}`).trim())
    })
    expect(hostInsets).toEqual(['44px', '20px', '34px', '16px'])
    await holdImage({ x: 0.04, y: 0.5 })
    const safeAreaPicker = page.getByRole('group', { name: 'Реакции', exact: true })
    await expect(safeAreaPicker).toBeVisible()
    await expect(safeAreaPicker.getByRole('button')).toHaveCount(6)
    await expect.poll(async () => {
      const bounds = await safeAreaPicker.boundingBox()
      if (!bounds) return false
      return bounds.y >= 56 && bounds.x >= 28 && bounds.x + bounds.width <= 390 - 32 && bounds.y + bounds.height <= 844 - 122
    }).toBe(true)
    const safeAreaBounds = await safeAreaPicker.boundingBox()
    expect(safeAreaBounds).not.toBeNull()
    expect(safeAreaBounds!.y).toBeGreaterThanOrEqual(56)
    expect(safeAreaBounds!.x).toBeGreaterThanOrEqual(28)
    expect(safeAreaBounds!.x + safeAreaBounds!.width).toBeLessThanOrEqual(390 - 32)
    expect(safeAreaBounds!.y + safeAreaBounds!.height).toBeLessThanOrEqual(844 - 122)
    await expect.poll(async () => {
      const heights = await safeAreaPicker.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))
      return heights.length === 6 && heights.every((height) => height >= 44)
    }).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-safe-area.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')

    await feedSurface.evaluate((surface) => {
      for (const side of ['top', 'right', 'bottom', 'left']) surface.style.setProperty(`--host-inset-${side}`, '0px')
      surface.style.setProperty('--reaction-safe-inset-top', '44px')
      surface.style.setProperty('--reaction-safe-inset-right', '20px')
      surface.style.setProperty('--reaction-safe-inset-bottom', '34px')
      surface.style.setProperty('--reaction-safe-inset-left', '16px')
    })
    const simulatedSafeAreaInsets = await feedSurface.evaluate((surface) => {
      const style = getComputedStyle(surface)
      return ['top', 'right', 'bottom', 'left'].map((side) => ({
        host: style.getPropertyValue(`--host-inset-${side}`).trim(),
        safeArea: style.getPropertyValue(`--reaction-safe-inset-${side}`).trim(),
      }))
    })
    expect(simulatedSafeAreaInsets).toEqual([
      { host: '0px', safeArea: '44px' },
      { host: '0px', safeArea: '20px' },
      { host: '0px', safeArea: '34px' },
      { host: '0px', safeArea: '16px' },
    ])
    await holdImage({ x: 0.98, y: 0.03 })
    await expect(safeAreaPicker).toBeVisible()
    const envSafeAreaBounds = await safeAreaPicker.boundingBox()
    expect(envSafeAreaBounds).not.toBeNull()
    expect(envSafeAreaBounds!.y).toBeGreaterThanOrEqual(56)
    expect(envSafeAreaBounds!.x).toBeGreaterThanOrEqual(28)
    expect(envSafeAreaBounds!.x + envSafeAreaBounds!.width).toBeLessThanOrEqual(390 - 32)
    expect(envSafeAreaBounds!.y + envSafeAreaBounds!.height).toBeLessThanOrEqual(844 - 122)
    await expect(safeAreaPicker.getByRole('button')).toHaveCount(6)
    await expect.poll(async () => {
      const heights = await safeAreaPicker.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))
      return heights.length === 6 && heights.every((height) => height >= 44)
    }).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-picker-safe-area-env.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
  })

  test('dragging away after a recognized hold cannot select a reaction or open the photo', async ({ page }) => {
    await openFeed(page)
    const image = page.locator('.memory-media-slot img').first()
    const card = image.locator('xpath=ancestor::article[@data-memory-id]')
    await image.scrollIntoViewIfNeeded()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    let writes = 0
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => {
      writes += 1
      await route.continue()
    })

    const x = bounds!.x + bounds!.width / 2
    const y = bounds!.y + bounds!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(550)
    const picker = page.getByRole('group', { name: 'Реакции', exact: true })
    await expect(picker).toBeVisible()
    const laugh = page.getByRole('button', { name: 'Смех' })
    const laughBounds = await laugh.boundingBox()
    expect(laughBounds).not.toBeNull()
    await page.mouse.move(laughBounds!.x + laughBounds!.width / 2, laughBounds!.y + laughBounds!.height / 2)
    await page.mouse.up()

    await expect(picker).toBeVisible()
    await expect(card.locator('.pswp')).toHaveCount(0)
    expect(writes).toBe(0)
    await expect(card.locator('[data-slot="memory-reactions"]')).toHaveCount(0)
  })

  test('a held standalone photo moved away and back cannot open PhotoSwipe or mutate', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Одиночное фото E2E' })
    const image = card.locator('.memory-media-slot img').first()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    await image.evaluate(async (element: HTMLImageElement) => element.decode())
    await image.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
    const initialBounds = await image.boundingBox()
    expect(initialBounds).not.toBeNull()
    await page.mouse.move(initialBounds!.x + initialBounds!.width / 2, initialBounds!.y + initialBounds!.height / 2)
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    let writes = 0
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => { writes += 1; await route.continue() })
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
    const pressBounds = await image.boundingBox()
    expect(pressBounds).not.toBeNull()
    const pressPoint = { x: pressBounds!.x + pressBounds!.width / 2, y: pressBounds!.y + pressBounds!.height / 2 }
    const x = pressPoint.x
    const y = pressPoint.y
    await page.mouse.move(pressPoint.x, pressPoint.y)
    expect(await image.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, pressPoint)).toBe(true)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.mouse.move(x + 24, y)
    await page.mouse.move(x, y)
    await page.mouse.up()
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page.locator('.pswp')).toHaveCount(0)
    expect(writes).toBe(0)
    await page.keyboard.press('Escape')
    await image.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await page.locator('.pswp__button--close').click()
  })

  test('keyboard selection and last-reaction removal return focus to the Memory card', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Фотоальбом E2E' }).first()
    await card.focus()
    let selected: string | null = null
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => {
      selected = (route.request().postDataJSON() as { reaction: string | null }).reaction
      const reactionCounts = selected ? { laugh: 1 } : {}
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reactionCounts, currentUserReaction: selected, likes: { count: selected ? 1 : 0, likedByMe: false } }) })
    })

    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Смех', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => selected).toBe('laugh')
    await expect.poll(() => card.evaluate((element) => element.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Смех, выбрана', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => selected).toBeNull()
    await expect.poll(() => card.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  })

  test('Chromium touch hold opens once after release and note text holds stay selectable', async ({ page }) => {
    await openFeed(page)
    const image = page.locator('.memory-media-slot img').first()
    await image.scrollIntoViewIfNeeded()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    const x = Math.round(bounds!.x + bounds!.width / 2)
    const y = Math.round(bounds!.y + bounds!.height / 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }] })
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await cdp.detach()

    await page.keyboard.press('Escape')
    const noteText = page.locator('[data-memory-kind="note"] [data-memoly-note-gradient]').first()
    await expect(noteText).toBeVisible()
    const noteBounds = await noteText.boundingBox()
    expect(noteBounds).not.toBeNull()
    await page.mouse.move(noteBounds!.x + noteBounds!.width / 2, noteBounds!.y + noteBounds!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()
  })

  test('MAX reaction haptics fire only for recognized holds and accepted choices', async ({ page }) => {
    await openFeed(page)
    await page.route('**/api/v1/families/*/memories/*/reaction', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ reactionCounts: { laugh: 1 }, currentUserReaction: 'laugh', likes: { count: 1, likedByMe: false } }),
    }))
    const calls = await page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])
    expect(calls).toEqual([])
    const image = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Одиночное фото E2E' }).locator('.memory-media-slot img').first()
    const card = image.locator('xpath=ancestor::article[@data-memory-id]')
    await image.scrollIntoViewIfNeeded()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    const startX = bounds!.x + bounds!.width / 2
    const startY = bounds!.y + bounds!.height / 2
    expect(await image.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, { x: startX, y: startY })).toBe(true)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.waitForTimeout(100)
    await page.mouse.move(startX + 24, startY)
    await page.waitForTimeout(550)
    await page.mouse.up()
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual([])
    await image.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    const recognizedBounds = await image.boundingBox()
    expect(recognizedBounds).not.toBeNull()
    const recognizedPoint = { x: recognizedBounds!.x + recognizedBounds!.width / 2, y: recognizedBounds!.y + recognizedBounds!.height / 2 }
    expect(await image.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, recognizedPoint)).toBe(true)
    await page.mouse.move(recognizedPoint.x, recognizedPoint.y)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light'])
    await page.waitForTimeout(650)
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light'])
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light'])
    const reopenPoint = await page.evaluate(({ memoryId }) => {
      const image = document.querySelector(`[data-memory-id="${memoryId}"] .memory-media-slot img`)
      if (!image) return null
      const bounds = image.getBoundingClientRect()
      for (const [xRatio, yRatio] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92], [0.5, 0.08], [0.5, 0.92]]) {
        const point = { x: bounds.x + bounds.width * xRatio, y: bounds.y + bounds.height * yRatio }
        const target = document.elementFromPoint(point.x, point.y)
        if (target === image && !target.closest('.reaction-picker')) return point
      }
      return null
    }, { memoryId: await card.getAttribute('data-memory-id') })
    expect(reopenPoint).not.toBeNull()
    await page.evaluate(() => {
      type TraceEntry = { elapsedMs: number; state: string; className: string; present: boolean }
      const testWindow = window as typeof window & { __reactionPickerTrace?: TraceEntry[]; __reactionPickerObserver?: MutationObserver }
      const trace: TraceEntry[] = []
      let previous = ''
      const record = () => {
        const picker = document.querySelector<HTMLElement>('.reaction-picker')
          ?? document.querySelector<HTMLElement>('[role="group"][aria-label="Реакции"]')
        const state = picker?.getAttribute('data-state') ?? 'no-data-state'
        const className = typeof picker?.className === 'string' ? picker.className : ''
        const signature = `${picker ? 'present' : 'removed'}:${state}:${className}`
        if (signature !== previous) {
          trace.push({ elapsedMs: Math.round(performance.now()), state, className, present: Boolean(picker) })
          previous = signature
        }
      }
      testWindow.__reactionPickerTrace = trace
      record()
      const observer = new MutationObserver(record)
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-state'], childList: true, subtree: true })
      testWindow.__reactionPickerObserver = observer
    })
    await page.mouse.move(reopenPoint!.x, reopenPoint!.y)
    await page.mouse.down()
    const picker = page.getByRole('group', { name: 'Реакции', exact: true })
    await page.waitForTimeout(100)
    const pickerAfterOutsidePointerDown = await page.evaluate(() => {
      const picker = document.querySelector<HTMLElement>('.reaction-picker')
        ?? document.querySelector<HTMLElement>('[role="group"][aria-label="Реакции"]')
      return { count: picker ? 1 : 0, visible: Boolean(picker && picker.getBoundingClientRect().width > 0 && picker.getBoundingClientRect().height > 0), state: picker?.getAttribute('data-state') ?? null }
    })
    const hapticsAfterOutsidePointerDown = await page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])
    await page.waitForTimeout(450)
    await expect(picker).toBeVisible()
    const hapticsAfterHold = await page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])
    const pickerAfterHold = await page.evaluate(() => {
      const picker = document.querySelector<HTMLElement>('.reaction-picker')
        ?? document.querySelector<HTMLElement>('[role="group"][aria-label="Реакции"]')
      return { count: picker ? 1 : 0, visible: Boolean(picker && picker.getBoundingClientRect().width > 0 && picker.getBoundingClientRect().height > 0), state: picker?.getAttribute('data-state') ?? null, trace: (window as typeof window & { __reactionPickerTrace?: unknown[] }).__reactionPickerTrace ?? [] }
    })
    expect(pickerAfterOutsidePointerDown.state).toBe('open')
    expect(pickerAfterHold.state).toBe('open')
    expect(hapticsAfterOutsidePointerDown).toEqual(['light'])
    expect(hapticsAfterHold).toEqual(['light'])
    await page.mouse.up()
    const outsideClickPoint = await page.evaluate(() => {
      const candidates = [{ x: 8, y: Math.floor(innerHeight / 2) }, { x: innerWidth - 8, y: Math.floor(innerHeight / 2) }, { x: 8, y: 8 }]
      for (const point of candidates) {
        const target = document.elementFromPoint(point.x, point.y)
        if (target && !target.closest('.reaction-picker, article, button, input, a, [role="button"]')) return { ...point, target: target.tagName.toLowerCase() }
      }
      return null
    })
    expect(outsideClickPoint).not.toBeNull()
    await page.mouse.click(outsideClickPoint!.x, outsideClickPoint!.y)
    await expect(picker).toHaveCount(0)
    const closeTrace = await page.evaluate(() => {
      const testWindow = window as typeof window & { __reactionPickerTrace?: Array<{ state: string; present: boolean }>; __reactionPickerObserver?: MutationObserver }
      testWindow.__reactionPickerObserver?.disconnect()
      return testWindow.__reactionPickerTrace ?? []
    })
    console.log('[MAX picker outside hold]', JSON.stringify({ outsideClickPoint, pickerAfterOutsidePointerDown, hapticsAfterOutsidePointerDown, pickerAfterHold, hapticsAfterHold, closeTrace }))
    await image.scrollIntoViewIfNeeded()
    const nextOpenBounds = await image.boundingBox()
    expect(nextOpenBounds).not.toBeNull()
    const nextOpenPoint = { x: nextOpenBounds!.x + nextOpenBounds!.width / 2, y: nextOpenBounds!.y + nextOpenBounds!.height / 2 }
    expect(await image.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, nextOpenPoint)).toBe(true)
    await page.mouse.move(nextOpenPoint.x, nextOpenPoint.y)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(picker).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light', 'light'])
    await page.mouse.up()
    await page.getByRole('button', { name: 'Смех', exact: true }).click()
    await expect(card.locator('[data-reaction="laugh"]')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light', 'light', 'soft'])
  })

  test('MAX reaction haptic throws and rejections do not interrupt hold or reaction selection', async ({ page }) => {
    await openFeed(page)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ reactionCounts: { laugh: 1 }, currentUserReaction: 'laugh', likes: { count: 1, likedByMe: false } }),
    }))
    await page.evaluate(() => { (window as typeof window & { __maxHapticBehavior?: unknown }).__maxHapticBehavior = { throwOn: 'light', rejectOn: 'soft' } })
    const noteText = page.locator('[data-memory-kind="note"] .caption').first()
    await noteText.scrollIntoViewIfNeeded()
    const noteBounds = await noteText.boundingBox()
    expect(noteBounds).not.toBeNull()
    await page.mouse.move(noteBounds!.x + 4, noteBounds!.y + noteBounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(noteBounds!.x + noteBounds!.width - 4, noteBounds!.y + noteBounds!.height / 2, { steps: 6 })
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual([])
    if (await page.getByRole('dialog', { name: 'Воспоминание' }).count()) await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Воспоминание' })).toHaveCount(0)

    const image = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Одиночное фото E2E' }).locator('.memory-media-slot img').first()
    await image.scrollIntoViewIfNeeded()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    expect(await image.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 })).toBe(true)
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light'])
    await page.mouse.up()
    await page.getByRole('button', { name: 'Смех', exact: true }).click()
    await expect(page.locator('[data-reaction="laugh"]')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxHapticCalls?: string[] }).__maxHapticCalls ?? [])).toEqual(['light', 'soft'])
    expect(pageErrors).toEqual([])
  })

  test('movement, pointer cancellation, and a second touch cancel recognition without opening a viewer', async ({ page }) => {
    await openFeed(page)
    const image = page.locator('.memory-media-slot img').first()
    await image.scrollIntoViewIfNeeded()
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    const x = Math.round(bounds!.x + bounds!.width / 2)
    const y = Math.round(bounds!.y + bounds!.height / 2)
    const cdp = await page.context().newCDPSession(page)

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(100)
    await page.mouse.move(x + 24, y)
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()
    await expect(page.locator('.pswp')).toHaveCount(0)

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }] })
    await page.waitForTimeout(100)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }, { id: 2, x: x + 15, y: y + 15, radiusX: 1, radiusY: 1, force: 1 }] })
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await cdp.detach()
  })

  test('note text remains selectable and cannot open the reaction picker', async ({ page }) => {
    await openFeed(page)
    const note = page.locator('[data-memory-kind="note"] [data-memoly-note-gradient]').first()
    await expect(note).toBeVisible()
    const bounds = await note.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + 4, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + bounds!.width - 4, bounds!.y + bounds!.height / 2, { steps: 6 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.getSelection()?.toString().trim().length ?? 0)).toBeGreaterThan(0)
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()

    await note.scrollIntoViewIfNeeded()
    const paddingBounds = await note.boundingBox()
    expect(paddingBounds).not.toBeNull()
    const paddingX = paddingBounds!.x + 2
    const paddingY = paddingBounds!.y + 2
    await page.mouse.move(paddingX, paddingY)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/reactions-note-padding-picker.png'), animations: 'disabled' })
    await page.mouse.up()
  })

  test('mixed Memory keeps one reaction target across photo and video surfaces while seek controls are excluded', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-kind="media"]').filter({ hasText: 'Смешанное воспоминание E2E' })
    await card.scrollIntoViewIfNeeded()
    const memoryId = await card.getAttribute('data-memory-id')
    const payloads: Array<{ url: string; reaction: string }> = []
    await page.route('**/api/v1/families/*/memories/*/reaction', async (route) => {
      payloads.push({ url: route.request().url(), reaction: (route.request().postDataJSON() as { reaction: string }).reaction })
      const reactionCounts = { laugh: 1, love: 1, wow: 1 }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reactionCounts, currentUserReaction: payloads.at(-1)!.reaction, likes: { count: Object.values(reactionCounts).reduce((total, count) => total + count, 0), likedByMe: false } }) })
    })

    const hold = async (surface: import('@playwright/test').Locator, point = { x: 0.5, y: 0.5 }) => {
      await surface.scrollIntoViewIfNeeded()
      const rect = await surface.boundingBox()
      expect(rect).not.toBeNull()
      await page.mouse.move(rect!.x + rect!.width * point.x, rect!.y + rect!.height * point.y)
      await page.mouse.down()
      await page.waitForTimeout(1_050)
      await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
      await page.mouse.up()
    }
    const photo = card.locator('[data-carousel-active="true"] img')
    await hold(photo)
    await page.getByRole('button', { name: 'Смех', exact: true }).click()
    await expect.poll(() => payloads.length).toBe(1)
    await expect(card.locator('[data-reaction="laugh"]')).toBeVisible()
    await expect.poll(() => card.getAttribute('data-memory-id')).toBe(memoryId)

    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    const video = card.locator('[data-carousel-active="true"] video')
    await expect(video).toBeVisible()
    const seek = card.locator('[data-carousel-active="true"] .memoly-private-video-v2-controls input[type="range"]').first()
    await seek.scrollIntoViewIfNeeded()
    await expect(seek).toBeVisible()
    const seekRect = await seek.boundingBox()
    expect(seekRect).not.toBeNull()
    expect(await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y)
      const controls = document.querySelector('[data-carousel-active="true"] .memoly-private-video-v2-controls')
      const seekInput = controls?.querySelector('input[type="range"]')
      return Boolean(target && controls?.contains(target) && seekInput && getComputedStyle(seekInput).visibility !== 'hidden')
    }, { x: seekRect!.x + seekRect!.width / 2, y: seekRect!.y + seekRect!.height / 2 })).toBe(true)
    await page.mouse.move(seekRect!.x + seekRect!.width / 2, seekRect!.y + seekRect!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()
    await hold(video, { x: 0.08, y: 0.08 })
    await page.getByRole('button', { name: 'Влюблённость', exact: true }).click()
    await expect.poll(() => payloads.length).toBe(2)
    expect(payloads.map((entry) => entry.reaction)).toEqual(['laugh', 'love'])
    expect(payloads.every(({ url }) => url.endsWith(`/memories/${memoryId}/reaction`))).toBe(true)
    await expect(card.locator('[data-reaction="love"]')).toBeVisible()

    const voiceCard = page.locator('[data-memory-kind="voice"]').filter({ hasText: 'Голос E2E' }).first()
    const voiceId = await voiceCard.getAttribute('data-memory-id')
    const waveform = voiceCard.locator('[data-slot="voice-waveform"]')
    await expect(waveform).toBeVisible()
    await waveform.scrollIntoViewIfNeeded()
    const waveformBounds = await waveform.boundingBox()
    expect(waveformBounds).not.toBeNull()
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-slot="voice-waveform"]') !== null, { x: waveformBounds!.x + waveformBounds!.width / 2, y: waveformBounds!.y + waveformBounds!.height / 2 })).toBe(true)
    await page.mouse.move(waveformBounds!.x + waveformBounds!.width / 2, waveformBounds!.y + waveformBounds!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    await page.mouse.up()

    const voiceSurface = voiceCard.locator('.ml-audio')
    await voiceSurface.scrollIntoViewIfNeeded()
    const voiceSurfaceBounds = await voiceSurface.boundingBox()
    expect(voiceSurfaceBounds).not.toBeNull()
    const voiceFreePoint = await page.evaluate(({ x, y, width, height }) => {
      for (let row = 1; row < 20; row += 1) {
        for (let column = 1; column < 20; column += 1) {
          const point = { x: x + width * column / 20, y: y + height * row / 20 }
          const target = document.elementFromPoint(point.x, point.y)
          if (target?.closest('.ml-audio') && !target.closest('button, input, audio, [data-slot="voice-waveform"]')) return point
        }
      }
      return null
    }, { x: voiceSurfaceBounds!.x, y: voiceSurfaceBounds!.y, width: voiceSurfaceBounds!.width, height: voiceSurfaceBounds!.height })
    expect(voiceFreePoint).not.toBeNull()
    const relativeVoicePoint = { x: (voiceFreePoint!.x - voiceSurfaceBounds!.x) / voiceSurfaceBounds!.width, y: (voiceFreePoint!.y - voiceSurfaceBounds!.y) / voiceSurfaceBounds!.height }
    const actualVoiceTarget = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y)
      return Boolean(target && target.closest('.ml-audio') && !target.closest('button, input, audio, [data-slot="voice-waveform"]'))
    }, voiceFreePoint!)
    expect(actualVoiceTarget).toBe(true)
    await hold(voiceSurface, relativeVoicePoint)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
    expect(payloads).toHaveLength(2)
    await expect(voiceCard.locator('[data-reaction="wow"]')).toHaveCount(0)

    const tapVoiceControl = async (button: import('@playwright/test').Locator) => {
      await button.scrollIntoViewIfNeeded()
      const bounds = await button.boundingBox()
      expect(bounds).not.toBeNull()
      const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
      const isActualButtonTarget = await button.evaluate((element, { x, y }) => document.elementFromPoint(x, y)?.closest('button') === element, point)
      expect(isActualButtonTarget).toBe(true)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.up()
    }
    const voice = voiceCard.locator('audio')
    await tapVoiceControl(voiceCard.getByRole('button', { name: 'Слушать', exact: true }))
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)
    await expect(voiceCard.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible()
    expect(payloads).toHaveLength(2)
    await expect(voiceCard.locator('[data-reaction="wow"]')).toHaveCount(0)
    await tapVoiceControl(voiceCard.getByRole('button', { name: 'Пауза', exact: true }))
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    expect(payloads).toHaveLength(2)

    await hold(voiceSurface, relativeVoicePoint)
    await page.getByRole('button', { name: 'Удивление', exact: true }).click()
    await expect.poll(() => payloads.length).toBe(3)
    expect(payloads[2]?.reaction).toBe('wow')
    expect(payloads[2]?.url.endsWith(`/memories/${voiceId}/reaction`)).toBe(true)
  })

  test('leaving the family while a hold is pending cancels it and closes an open picker', async ({ page }) => {
    await openFeed(page)
    const image = page.locator('.memory-media-slot img').first()
    await image.scrollIntoViewIfNeeded()
    const rect = await image.boundingBox()
    expect(rect).not.toBeNull()
    const x = Math.round(rect!.x + rect!.width / 2)
    const y = Math.round(rect!.y + rect!.height / 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }] })
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: '‹ Все семьи' }).evaluate((button) => (button as HTMLButtonElement).click())
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.locator('[data-slot="family-hub"]')).toBeVisible()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)

    await cdp.detach()
    await page.reload()
    await expect(page.locator('[data-slot="family-hub"]')).toBeVisible()
    await openFeed(page)
    await image.scrollIntoViewIfNeeded()
    const openRect = await image.boundingBox()
    expect(openRect).not.toBeNull()
    await page.mouse.move(openRect!.x + openRect!.width / 2, openRect!.y + openRect!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toBeVisible()
    await page.mouse.up()
    await page.getByRole('button', { name: '‹ Все семьи' }).click()
    await expect(page.locator('[data-slot="family-hub"]')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Реакции', exact: true })).toHaveCount(0)
  })

  test('mixed unread Memory waits for active readiness, resets dwell on slide change, and stays until seen ack', async ({ page }) => {
    const memoryId = randomUUID()
    const photoKey = `media-display/${randomUUID()}-unread.png`
    const videoKey = `media-playback/${randomUUID()}-unread.mp4`
    const unvisitedPhotoKey = `media-display/${randomUUID()}-unvisited.png`
    fixture.objectKeys.push(photoKey, videoKey, unvisitedPhotoKey)
    const videoBytes = generatedMedia(['-f', 'lavfi', '-i', 'color=c=pink:s=320x180:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
    await store(photoKey, pngImage.buffer, 'image/png')
    await store(videoKey, videoBytes, 'video/mp4')
    await store(unvisitedPhotoKey, pngImage.buffer, 'image/png')
    const photo = await createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key: photoKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
    const video = await createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'video', variant: 'playback', key: videoKey, bytes: videoBytes, mime: 'video/mp4', width: 320, height: 180, durationMs: 8_000 })
    const unvisitedPhoto = await createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key: unvisitedPhotoKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
    let releasePhoto = () => undefined
    let releaseSeen = () => undefined
    const photoGate = new Promise<void>((resolve) => { releasePhoto = resolve })
    const seenGate = new Promise<void>((resolve) => { releaseSeen = resolve })
    let seenPostStarted = 0
    try {
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 1n } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
        await tx.memory.create({ data: {
          id: memoryId, familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
          kind: 'media', body: 'Непросмотренное смешанное E2E', occurredAt: new Date(), firstPublishedAt: new Date(), firstPublishedOrdinal: 1n,
          media: { create: [{ mediaId: photo.id, position: 0 }, { mediaId: video.id, position: 1 }, { mediaId: unvisitedPhoto.id, position: 2 }] },
        } })
      })
      await page.route(`**/media/${photo.id}/content?variant=display`, async (route) => { await photoGate; await route.continue() })
      await page.route('**/memories/seen', async (route) => { seenPostStarted += 1; await seenGate; await route.continue() })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.reload()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /1 непросмотренных воспоминаний/)
      await page.locator('.family-hub-card').click()
      await page.getByRole('button', { name: 'Показать 1 непросмотренное воспоминание' }).click()
      const card = page.locator(`[data-memory-id="${memoryId}"]`)
      await expect(card).toBeVisible()
      await card.scrollIntoViewIfNeeded()
      await expect(card.getByLabel('Загрузка фотографии')).toBeVisible()
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId } })).toBe(0)
      expect(seenPostStarted).toBe(0)
      releasePhoto()
      await expect(card.locator('[data-carousel-active="true"] [data-seen-ready="true"]')).toBeVisible()
      await page.waitForTimeout(450)
      await card.getByRole('button', { name: 'Следующий элемент' }).click()
      await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
      await expect(card.locator('[data-carousel-active="true"]')).toHaveAttribute('data-media-kind', 'video')
      await expect(card.locator('[data-carousel-position="3"]')).toHaveAttribute('aria-hidden', 'true')
      await expect(card.locator('[data-carousel-active="true"] [data-seen-ready="true"]')).toBeVisible()
      await page.waitForTimeout(550)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId } })).toBe(0)
      expect(seenPostStarted).toBe(0)
      await expect(card).toBeVisible()
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 1')
      await expect.poll(() => seenPostStarted).toBe(1)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId } })).toBe(0)
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 1')
      releaseSeen()
      await expect.poll(() => prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId } })).toBe(1)
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 0')
      await expect(card).toBeVisible()
      await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-current', 'step')
      await expect(card.locator('[data-carousel-position="3"]')).toHaveAttribute('aria-hidden', 'true')
      await card.getByRole('button', { name: 'Предыдущий элемент' }).click()
      await expect(card.locator('[data-carousel-dot]')).toHaveCount(3)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId } })).toBe(1)
      expect(seenPostStarted).toBe(1)
    } finally {
      releasePhoto()
      releaseSeen()
      await prisma.memory.deleteMany({ where: { id: memoryId } })
      await prisma.mediaAsset.deleteMany({ where: { id: { in: [photo.id, video.id, unvisitedPhoto.id] } } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: null, publicationOrdinal: 0n } })
      await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: null } })
    }
  })

  test('B6 real observer and seen API take seven unread to five without moving cards or another user', async ({ page, browser }) => {
    const secondSubject = String(900_000_000 + Math.floor(Math.random() * 90_000_000))
    const secondUser = await prisma.user.create({ data: { displayName: 'Другой зритель E2E' } })
    const errorPhoto = await prisma.memory.findFirstOrThrow({ where: { familyId: fixture.familyId, body: 'Одиночное фото E2E' } })
    const sevenIds = Array.from({ length: 7 }, () => randomUUID())
    const oldDate = Date.now() - 500 * 24 * 60 * 60_000
    const body = (index: number) => `Непросмотренная заметка ${index + 1}\n${Array.from({ length: 28 }, (_, line) => `Строка ${line + 1} семейного воспоминания`).join('\n')}`
    let secondContext: Awaited<ReturnType<typeof browser.newContext>> | null = null
    let sameAccountContext: Awaited<ReturnType<typeof browser.newContext>> | null = null
    try {
      await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject: secondSubject } })
      await prisma.externalIdentity.create({ data: { userId: secondUser.id, provider: 'telegram', subject: secondSubject } })
      await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: secondUser.id, role: 'viewer', unreadBaselineOrdinal: 0n } })
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 0n } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
        for (const [index, id] of sevenIds.entries()) {
          await tx.family.update({ where: { id: fixture.familyId }, data: { publicationOrdinal: BigInt(index + 1) } })
          await tx.memory.create({ data: {
            id, familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
            kind: 'note', body: body(index), occurredAt: new Date(oldDate - index * 60_000),
            firstPublishedAt: new Date(),
            firstPublishedOrdinal: BigInt(index + 1),
          } })
        }
      })

      await page.route('**/media/*/content?variant=display', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
      await page.setViewportSize({ width: 390, height: 650 })
      await page.reload()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)
      secondContext = await browser.newContext({ viewport: { width: 390, height: 650 } })
      const secondPage = await secondContext.newPage()
      await installTelegramHost(secondPage, signedInitData(Number(secondSubject), 'Другой зритель E2E'))
      await secondPage.goto('/')
      await expect(secondPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)

      await page.bringToFront()
      await page.locator('.family-hub-card').click()
      await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
      await page.getByRole('button', { name: 'Показать 7 непросмотренных воспоминаний' }).click()
      await expect(page.locator('#root [data-memory-id]')).toHaveCount(7)
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-seven.png'), animations: 'disabled' })

      const first = page.locator(`[data-memory-id="${sevenIds[0]}"]`)
      await first.locator('[data-seen-main]').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
      })
      await first.getByRole('button', { name: 'Действия с воспоминанием' }).click()
      await expect(page.locator('[data-memoly-bottom-sheet="true"]')).toBeVisible()
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: sevenIds[0] } })).toBe(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-memoly-bottom-sheet="true"]')).toHaveCount(0)

      for (let index = 0; index < 2; index += 1) {
        const content = page.locator(`[data-memory-id="${sevenIds[index]}"] [data-seen-main]`)
        await content.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
        })
        await expect.poll(() => prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: { in: sevenIds } } })).toBe(index + 1)
      }
      const anchor = page.locator(`[data-memory-id="${sevenIds[1]}"]`)
      const anchorTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 5')
      expect(await page.locator('#root [data-memory-id]').count()).toBe(7)
      expect(Math.abs((await anchor.evaluate((element) => element.getBoundingClientRect().top)) - anchorTop)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-five-stable.png'), animations: 'disabled' })

      await page.locator(`[data-memory-id="${sevenIds[2]}"] [data-seen-main]`).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
      })
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: sevenIds[2] } })).toBe(0)
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' })
        Reflect.deleteProperty(document, 'visibilityState')
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await page.getByRole('button', { name: '‹ Все семьи' }).click()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /5 непросмотренных воспоминаний/)
      await expect(secondPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)
      sameAccountContext = await browser.newContext({ viewport: { width: 390, height: 650 } })
      const sameAccountPage = await sameAccountContext.newPage()
      await installTelegramHost(sameAccountPage, signedInitData(Number(subject), 'Лента E2E'))
      await sameAccountPage.goto('/')
      await expect(sameAccountPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /5 непросмотренных воспоминаний/)

      await page.locator('.family-hub-card').click()
      await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
      const failedPhotoCard = page.locator(`[data-memory-id="${errorPhoto.id}"]`)
      await failedPhotoCard.scrollIntoViewIfNeeded()
      await expect(failedPhotoCard.getByLabel('Загрузка фотографии')).toBeVisible()
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: errorPhoto.id } })).toBe(0)

      await expect(page.getByRole('button', { name: 'Показать 5 непросмотренных воспоминаний' })).toBeVisible()
      await page.getByRole('button', { name: 'Показать 5 непросмотренных воспоминаний' }).click()
      const membership = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } } })
      await prisma.memorySeen.createMany({ data: sevenIds.map((memoryId) => ({ familyId: fixture.familyId, userId: fixture.userId, membershipEpoch: membership.membershipEpoch, memoryId })), skipDuplicates: true })
      await page.getByRole('button', { name: 'Обновить список' }).click()
      await expect(page.getByText('Все новые воспоминания просмотрены')).toBeVisible()
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect(page.locator('.feed-unread-mode .feed-unread-label').first()).toHaveText('Непросмотренные · 0')
      await expect(page.getByRole('button', { name: 'Выйти из режима непросмотренных' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Показать все' })).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-empty.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Выйти из режима непросмотренных' }).click()
      await expect(page.locator('.feed-unread-action, .feed-unread-mode')).toHaveCount(0)
    } finally {
      await sameAccountContext?.close()
      await secondContext?.close()
      await prisma.memory.deleteMany({ where: { id: { in: sevenIds } } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: null, publicationOrdinal: 0n } })
      await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: null } })
      await prisma.familyMember.deleteMany({ where: { familyId: fixture.familyId, userId: secondUser.id } })
      await prisma.externalIdentity.deleteMany({ where: { userId: secondUser.id } })
      await prisma.user.delete({ where: { id: secondUser.id } })
      await prisma.pilotAdmission.deleteMany({ where: { provider: 'telegram', subject: secondSubject } })
    }
  })

  test('closes access and pauses playback after membership revoke', async ({ page }) => {
    await openFeed(page)
    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)
    const voiceHandle = await voice.elementHandle()
    expect(voiceHandle).not.toBeNull()

    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { revokedAt: new Date() },
    })
    await voiceCard.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('button', { name: 'Сердце', exact: true }).click()

    await expect(page.getByText(/^Доступ к этой семье (?:закрыт\.|изменился\. Выберите её снова в списке\.)$/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await expect(page.locator('.family-hub-card')).toHaveCount(0)
    await expect.poll(() => voiceHandle!.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await expect(page.locator('[data-memory-id]')).toHaveCount(0)
  })
})

async function seedFeed() {
  const objectKeys: string[] = []
  const prior = await prisma.externalIdentity.findUnique({
    where: { provider_subject: { provider: 'telegram', subject } },
    select: { userId: true },
  })
  if (prior) {
    const priorFamilies = await prisma.familyMember.findMany({ where: { userId: prior.userId }, select: { familyId: true, family: { select: { ownerUserId: true } } } })
    await prisma.memoryLike.deleteMany({ where: { familyId: { in: priorFamilies.map(({ familyId }) => familyId) } } })
    await prisma.family.deleteMany({ where: { id: { in: priorFamilies.map(({ familyId }) => familyId) } } })
    await prisma.user.delete({ where: { id: prior.userId } })
    const orphanedOwners = priorFamilies.map(({ family }) => family.ownerUserId).filter((userId) => userId !== prior.userId)
    if (orphanedOwners.length > 0) await prisma.user.deleteMany({ where: { id: { in: orphanedOwners } } })
  }
  const user = await prisma.user.create({ data: { displayName: 'Зритель E2E' } })
  const ownerUser = await prisma.user.create({ data: { displayName: 'Мама E2E' } })
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
  const familyId = randomUUID()
  const childId = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.family.create({ data: { id: familyId, ownerUserId: ownerUser.id, name: 'Семья E2E', timezone: 'Europe/Moscow' } })
    await tx.familyMember.create({ data: { familyId, userId: ownerUser.id, role: 'full' } })
    await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'viewer' } })
    await tx.child.create({ data: { id: childId, familyId, displayName: 'Лиза', birthDate: new Date('2024-02-29T00:00:00.000Z'), sex: 'girl' } })
  })

  const baseTime = Date.now() - 60_000
  await prisma.memory.createMany({
    data: Array.from({ length: 43 }, (_, index) => ({
      familyId,
      childId,
      authorId: ownerUser.id,
      kind: 'note' as const,
      body: `Заметка E2E ${index}`,
      occurredAt: new Date(baseTime - (index + 4) * 60_000),
      firstPublishedAt: new Date(baseTime),
    })),
  })

  const photoAssets = await Promise.all([0, 1].map(async (index) => {
    const key = `media-display/${randomUUID()}-${index}.png`
    objectKeys.push(key)
    await store(key, pngImage.buffer, 'image/png')
    return createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  }))
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Фотоальбом E2E', occurredAt: new Date(baseTime), assets: photoAssets })

  const singlePhotoKey = `media-display/${randomUUID()}-single.png`
  objectKeys.push(singlePhotoKey)
  await store(singlePhotoKey, pngImage.buffer, 'image/png')
  const singlePhotoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key: singlePhotoKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Одиночное фото E2E', occurredAt: new Date(baseTime - 30_000), assets: [singlePhotoAsset] })

  const voiceBytes = generatedMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'ipod', 'pipe:1'])
  const voiceKey = `media-playback/${randomUUID()}.m4a`
  objectKeys.push(voiceKey)
  await store(voiceKey, voiceBytes, 'audio/mp4')
  const voiceAsset = await createAsset({
    familyId, userId: ownerUser.id, kind: 'voice', variant: 'playback', key: voiceKey, bytes: voiceBytes, mime: 'audio/mp4', durationMs: 8_000,
    waveform: Array.from({ length: 48 }, (_, index) => ((index % 12) + 1) / 12),
  })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'voice', body: 'Голос E2E', occurredAt: new Date(baseTime - 60_000), assets: [voiceAsset] })

  const videoBytes = generatedMedia(['-f', 'lavfi', '-i', 'color=c=pink:s=320x180:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
  const videoKey = `media-playback/${randomUUID()}.mp4`
  objectKeys.push(videoKey)
  await store(videoKey, videoBytes, 'video/mp4')
  const videoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'video', variant: 'playback', key: videoKey, bytes: videoBytes, mime: 'video/mp4', width: 320, height: 180, durationMs: 8_000 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'video', body: 'Legacy video E2E', occurredAt: new Date(baseTime - 120_000), assets: [videoAsset] })
  const mixedPhotoAssets = await Promise.all([0, 1].map(async (index) => {
    const key = `media-display/${randomUUID()}-mixed-${index}.png`
    objectKeys.push(key)
    await store(key, pngImage.buffer, 'image/png')
    return createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  }))
  const mixedVideoKey = `media-playback/${randomUUID()}-mixed.mp4`
  objectKeys.push(mixedVideoKey)
  await store(mixedVideoKey, videoBytes, 'video/mp4')
  const mixedVideoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'video', variant: 'playback', key: mixedVideoKey, bytes: videoBytes, mime: 'video/mp4', width: 320, height: 180, durationMs: 8_000 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'media', body: 'Смешанное воспоминание E2E', occurredAt: new Date(baseTime - 150_000), assets: [mixedPhotoAssets[0], mixedVideoAsset, mixedPhotoAssets[1]] })

  const telegramMemory = await prisma.memory.create({ data: { familyId, childId, authorId: ownerUser.id, kind: 'video', body: 'Telegram video E2E', occurredAt: new Date(baseTime - 180_000), firstPublishedAt: new Date(baseTime) } })
  const thumbnailKey = `media-display/${randomUUID()}-telegram-poster.png`
  objectKeys.push(thumbnailKey)
  await store(thumbnailKey, pngImage.buffer, 'image/png')
  const thumbnail = await createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key: thumbnailKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  const botId = BigInt(`777${subject}`)
  const inbox = await prisma.telegramInbox.create({ data: { botId, updateId: 1n, eventKind: 'content', encryptedPayload: Buffer.from([1]), encryptionIv: Buffer.alloc(12, 2), encryptionAuthTag: Buffer.alloc(16, 3), processedAt: new Date() } })
  const source = await prisma.telegramSource.create({ data: { inboxId: inbox.id, botId, chatId: BigInt(subject), messageId: 1n, senderSubject: subject, userId: user.id, familyId, childId, kind: 'video', status: 'published', plannedMemoryId: telegramMemory.id, memoryId: telegramMemory.id } })
  await prisma.telegramVideoReference.create({ data: { sourceId: source.id, memoryId: telegramMemory.id, familyId, thumbnailMediaId: thumbnail.id, fileIdCiphertext: Buffer.from('synthetic-file-id'), encryptionIv: Buffer.alloc(12, 4), encryptionAuthTag: Buffer.alloc(16, 5), fileUniqueId: 'synthetic-unique-id', width: 320, height: 180, durationMs: 8_000 } })

  return { familyId, childId, userId: user.id, ownerUserId: ownerUser.id, botId, objectKeys, memoryCount: 49, mixedLastPhotoId: mixedPhotoAssets[1].id, mixedVideoId: mixedVideoAsset.id, legacyVideoId: videoAsset.id, voiceId: voiceAsset.id }
}

async function createAsset(input: { familyId: string; userId: string; kind: 'photo' | 'video' | 'voice'; variant: 'display' | 'playback'; key: string; bytes: Buffer; mime: string; width?: number; height?: number; durationMs?: number; waveform?: number[] }) {
  return prisma.mediaAsset.create({ data: {
    familyId: input.familyId,
    uploaderId: input.userId,
    sourceKind: 'upload',
    purpose: 'memory',
    mediaKind: input.kind,
    originalKey: `media-originals/${randomUUID()}`,
    declaredMime: input.kind === 'photo' ? input.mime : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    verifiedMime: input.kind === 'photo' ? input.mime : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    sha256: randomUUID().replaceAll('-', '').repeat(2),
    byteSize: BigInt(input.bytes.byteLength),
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
    waveform: input.waveform,
    originalStatus: 'stored',
    renditionStatus: 'ready',
    variants: { create: { variant: input.variant, objectKey: input.key, sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: BigInt(input.bytes.byteLength), mime: input.mime, width: input.width, height: input.height, durationMs: input.durationMs } },
  } })
}

async function createMemoryWithMedia(input: { familyId: string; childId: string; userId: string; kind: 'photo' | 'video' | 'voice' | 'media'; body: string; occurredAt: Date; assets: Array<{ id: string }> }) {
  return prisma.memory.create({ data: {
    familyId: input.familyId,
    childId: input.childId,
    authorId: input.userId,
    kind: input.kind,
    body: input.body,
    occurredAt: input.occurredAt,
    firstPublishedAt: new Date(),
    media: { create: input.assets.map((asset, position) => ({ mediaId: asset.id, position })) },
  } })
}

async function store(key: string, bytes: Buffer, contentType: string) {
  await storage.writeObject({ key, body: new Blob([bytes]).stream(), contentLength: bytes.byteLength, contentType })
}

function generatedMedia(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 20_000_000 })
  if (result.status !== 0) throw new Error(`ffmpeg fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function signedInitData(id: number, name: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id, first_name: name }),
  })
  const dataCheckString = [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

function contrastRatio(foreground: string, background: string) {
  const channels = (color: string): [number, number, number] => {
    const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    const hex = color.match(/^#([\da-f]{6})$/i)?.[1]
    if (!hex) throw new Error(`Unsupported computed color: ${color}`)
    const value = Number.parseInt(hex, 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  const luminance = (color: string) => {
    const linear = channels(color).map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

async function installTelegramHost(page: Page, initData: string, insets: { bottom?: number; top?: number } = {}) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript(({ bottomInset, initData: value, topInset }) => {
    const backHandlers = new Set<() => void>()
    const testWindow = window as typeof window & {
      __openedTelegramLink?: string
      __telegramBackHandlerCount?: () => number
      __triggerTelegramBack?: () => void
    }
    testWindow.__telegramBackHandlerCount = () => backHandlers.size
    testWindow.__triggerTelegramBack = () => { backHandlers.forEach((handler) => handler()) }
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value,
      version: '8.0',
      platform: 'tdesktop',
      safeAreaInset: { bottom: bottomInset, top: topInset },
      contentSafeAreaInset: { bottom: bottomInset, top: topInset },
      BackButton: {
        show() {},
        hide() {},
        onClick(handler: () => void) { backHandlers.add(handler) },
        offClick(handler: () => void) { backHandlers.delete(handler) },
      },
      ready() {},
      openTelegramLink(url: string) { testWindow.__openedTelegramLink = url },
    } } })
  }, { bottomInset: insets.bottom ?? 0, initData, topInset: insets.top ?? 0 })
}

async function installMaxHost(page: Page, initData: string) {
  await page.addInitScript(({ initData: signedData }) => {
    const testWindow = window as typeof window & { __openedMaxLink?: string }
    const testWindowWithHaptics = testWindow as typeof testWindow & { __maxHapticCalls?: string[]; __maxHapticBehavior?: { throwOn?: string; rejectOn?: string } }
    testWindowWithHaptics.__maxHapticCalls = []
    const webApp = {
      initData: signedData,
      version: '1.0',
      platform: 'ios',
      HapticFeedback: { impactOccurred(style: string) {
        testWindowWithHaptics.__maxHapticCalls?.push(style)
        if (testWindowWithHaptics.__maxHapticBehavior?.throwOn === style) throw new Error('Synthetic MAX haptic throw')
        if (testWindowWithHaptics.__maxHapticBehavior?.rejectOn === style) return Promise.reject(new Error('Synthetic MAX haptic rejection'))
        return undefined
      } },
      ready() {},
      openLink(url: string) { testWindow.__openedMaxLink = url },
    }
    Object.defineProperty(window, 'WebApp', { configurable: false, get: () => webApp })
  }, { initData })
}

async function installMaxAuthRoute(page: Page) {
  // Keep the existing Telegram-backed E2E identity while exercising the MAX client boundary;
  // no MAX backend or provider is enabled by this browser-only test.
  await page.route('**/api/v1/auth/max', async (route) => {
    const response = await route.fetch({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      postData: route.request().postData() ?? undefined,
      url: `${backendUrl}/api/v1/auth/telegram`,
    })
    await route.fulfill({ response })
  })
}

async function installObjectUrlTracker(page: Page) {
  await page.evaluate(() => {
    const tracked = { created: [] as string[], revoked: [] as string[] }
    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    const testWindow = window as typeof window & { __photoObjectUrls?: typeof tracked }
    testWindow.__photoObjectUrls = tracked
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob)
      tracked.created.push(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (tracked.created.includes(url)) tracked.revoked.push(url)
      revokeObjectUrl(url)
    }
  })
}

function objectUrlSnapshot(page: Page) {
  return page.evaluate(() => {
    const tracked = (window as typeof window & {
      __photoObjectUrls?: { created: string[]; revoked: string[] }
    }).__photoObjectUrls
    if (!tracked) throw new Error('Object URL tracker is not installed')
    return { created: [...tracked.created], revoked: [...tracked.revoked] }
  })
}

async function expectObjectUrlsClean(page: Page, expectedCount: number) {
  await expect.poll(async () => (await objectUrlSnapshot(page)).revoked.length).toBe(expectedCount)
  const snapshot = await objectUrlSnapshot(page)
  expect(snapshot.created).toHaveLength(expectedCount)
  expect(snapshot.revoked).toHaveLength(expectedCount)
  expect(new Set(snapshot.created).size).toBe(expectedCount)
  expect(new Set(snapshot.revoked).size).toBe(expectedCount)
  expect([...snapshot.revoked].sort()).toEqual([...snapshot.created].sort())
}

function telegramBackHandlerCount(page: Page) {
  return page.evaluate(() => {
    const count = (window as typeof window & { __telegramBackHandlerCount?: () => number }).__telegramBackHandlerCount
    if (!count) throw new Error('Telegram BackButton harness is not installed')
    return count()
  })
}

function triggerTelegramBack(page: Page) {
  return page.evaluate(() => {
    const trigger = (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack
    if (!trigger) throw new Error('Telegram BackButton harness is not installed')
    trigger()
  })
}

async function openFeed(page: Page) {
  await page.locator('[data-slot="family-hub"] .family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
  await expect(page.locator('[data-slot="memoly-filter-rail"]')).toHaveCount(0)
  await expect(page.locator('[data-memory-kind="photo"]').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
}

async function selectTheme(page: Page, theme: string) {
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: 'Оформление' }).click()
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/users/me') && response.request().method() === 'PATCH')
  await page.locator(`[data-theme-choice="${theme}"]`).click()
  await saved
  await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
  await page.getByRole('button', { name: 'Назад' }).click()
  await page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
}
