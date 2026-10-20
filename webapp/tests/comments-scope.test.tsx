import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import { commentsQueryKeys, removeCommentScopeQueries } from '../src/features/comments/queries'
import { isCurrentCommentScope } from '../src/features/comments/state'
import { isPersistableQueryKey, removePrivateFamilyQueries } from '../src/platform/persistence/private-cache'

const scope = { familyId: 'family-a', accountId: 'account-a', membershipEpoch: 4, memoryId: 'memory-a' }

describe('comments privacy scope', () => {
  it('rejects late responses after unmount, account, family, epoch, or memory changes', () => {
    expect(isCurrentCommentScope(scope, scope, true)).toBe(true)
    expect(isCurrentCommentScope(scope, scope, false)).toBe(false)
    expect(isCurrentCommentScope(scope, { ...scope, accountId: 'account-b' }, true)).toBe(false)
    expect(isCurrentCommentScope(scope, { ...scope, familyId: 'family-b' }, true)).toBe(false)
    expect(isCurrentCommentScope(scope, { ...scope, membershipEpoch: 5 }, true)).toBe(false)
    expect(isCurrentCommentScope(scope, { ...scope, memoryId: 'memory-b' }, true)).toBe(false)
  })

  it('uses a separate, non-persisted comments namespace and removes family comments data', async () => {
    const client = new QueryClient()
    const a = commentsQueryKeys.list('family-a', 'account-a', 4, 'memory-a')
    const b = commentsQueryKeys.list('family-b', 'account-a', 4, 'memory-b')
    client.setQueryData(a, { items: ['private text'] })
    client.setQueryData(b, { items: ['other family'] })
    expect(a[1]).toBe('comments')
    expect(isPersistableQueryKey(a)).toBe(false)
    await removePrivateFamilyQueries(client, 'family-a')
    expect(client.getQueryData(a)).toBeUndefined()
    expect(client.getQueryData(b)).toEqual({ items: ['other family'] })
    const summary = commentsQueryKeys.summaries('family-a', 'account-a', 4, ['memory-a'])
    client.setQueryData(summary, [{ memoryId: 'memory-a', count: 1 }])
    removeCommentScopeQueries(client, 'family-a', 'account-a', 4)
    expect(client.getQueryData(summary)).toBeUndefined()
    await client.cancelQueries()
    client.clear()
  })
})
