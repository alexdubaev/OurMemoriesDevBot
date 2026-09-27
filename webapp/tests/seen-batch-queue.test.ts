import { expect, test } from 'bun:test'
import { ApiRequestError } from '../src/platform/api'
import { SeenBatchQueue, SEEN_BATCH_LIMIT, type SeenScope } from '../src/features/feed/seen-batch-queue'

const scope: SeenScope = { accountId: 'account-a', familyId: 'family-a', membershipEpoch: 1 }
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('deduplicates candidates, batches at 50 and acknowledges only a successful response', async () => {
  const posts: Array<{ path: string; body: { memoryIds: string[]; expectedMembershipEpoch: number } }> = []
  const acknowledgements: string[][] = []
  const queue = new SeenBatchQueue(scope.accountId, { raw: async (path, options) => {
    posts.push({ path, body: options?.body as { memoryIds: string[]; expectedMembershipEpoch: number } })
    return new Response(null, { status: 204 })
  } }, (_scope, ids) => acknowledgements.push(ids), () => undefined)
  try {
    for (let index = 0; index < 51; index += 1) queue.enqueue(scope, id(index))
    queue.enqueue(scope, id(0))
    await sleep(350)
    expect(posts.map((post) => post.body.memoryIds.length)).toEqual([SEEN_BATCH_LIMIT, 1])
    expect(posts.every((post) => post.path.endsWith('/families/family-a/memories/seen'))).toBe(true)
    expect(posts.every((post) => post.body.expectedMembershipEpoch === 1)).toBe(true)
    expect(acknowledgements.flat()).toHaveLength(51)
    queue.enqueue(scope, id(0))
    await sleep(150)
    expect(posts).toHaveLength(2)
  } finally { queue.dispose() }
})

test('a failed batch remains unacknowledged and retries in its original family and epoch', async () => {
  const posts: Array<{ path: string; body: { expectedMembershipEpoch: number } }> = []
  const ack: SeenScope[] = []
  let fail = true
  const queue = new SeenBatchQueue(scope.accountId, { raw: async (path, options) => {
    posts.push({ path, body: options?.body as { expectedMembershipEpoch: number } })
    if (fail) { fail = false; throw new Error('offline') }
    return new Response(null, { status: 204 })
  } }, (confirmedScope) => ack.push(confirmedScope), () => undefined)
  try {
    queue.enqueue(scope, id(1))
    await sleep(150)
    expect(ack).toHaveLength(0)
    queue.resume()
    await sleep(30)
    expect(posts).toHaveLength(2)
    expect(posts.every((post) => post.path.includes('/family-a/') && post.body.expectedMembershipEpoch === 1)).toBe(true)
    expect(ack).toEqual([scope])
  } finally { queue.dispose() }
})

test('late old-epoch rejection cannot cancel a new membership queue', async () => {
  let rejectOld: ((error: Error) => void) | null = null
  const posts: number[] = []
  const rejected: string[] = []
  const queue = new SeenBatchQueue(scope.accountId, { raw: async (_path, options) => {
    const epoch = (options?.body as { expectedMembershipEpoch: number }).expectedMembershipEpoch
    posts.push(epoch)
    if (epoch === 1) return new Promise<Response>((_resolve, reject) => { rejectOld = reject })
    return new Response(null, { status: 204 })
  } }, () => undefined, (_scope, reason) => rejected.push(reason))
  try {
    queue.enqueue(scope, id(1))
    await sleep(140)
    queue.enqueue({ ...scope, membershipEpoch: 2 }, id(2))
    await sleep(140)
    rejectOld?.(new ApiRequestError(409, 'VERSION_CONFLICT', 'epoch'))
    await sleep(30)
    expect(posts).toEqual([1, 2])
    expect(rejected).toEqual(['epoch'])
    queue.enqueue({ ...scope, membershipEpoch: 2 }, id(2))
    await sleep(150)
    expect(posts).toEqual([1, 2])
  } finally { queue.dispose() }
})

test('account mismatch, revoke and logout cancel pending candidates', async () => {
  const posts: string[] = []
  const queue = new SeenBatchQueue(scope.accountId, { raw: async (path) => { posts.push(path); return new Response(null, { status: 204 }) } }, () => undefined, () => undefined)
  queue.enqueue({ ...scope, accountId: 'account-b' }, id(1))
  queue.enqueue(scope, id(2))
  queue.cancelFamily(scope.familyId)
  queue.enqueue({ ...scope, familyId: 'family-b' }, id(3))
  queue.dispose()
  await sleep(160)
  expect(posts).toEqual([])
})
