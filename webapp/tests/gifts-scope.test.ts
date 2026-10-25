import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import { giftsQueryKeys } from '../src/features/gifts/queries'
import { isPersistableQueryKey, removePrivateFamilyQueries } from '../src/platform/persistence/private-cache'

describe('gifts privacy scope', () => {
  it('keeps gifts out of the persisted cache and removes them when family access is lost', async () => {
    const client = new QueryClient()
    const familyA = giftsQueryKeys.list('family-a', 'account-a', 4)
    const familyB = giftsQueryKeys.list('family-b', 'account-a', 4)
    client.setQueryData(familyA, [{ title: 'private gift' }])
    client.setQueryData(familyB, [{ title: 'other family' }])

    expect(isPersistableQueryKey(familyA)).toBe(false)
    expect(familyA).not.toEqual(giftsQueryKeys.list('family-a', 'account-b', 4))
    expect(familyA).not.toEqual(giftsQueryKeys.list('family-a', 'account-a', 5))

    await removePrivateFamilyQueries(client, 'family-a')
    expect(client.getQueryData(familyA)).toBeUndefined()
    expect(client.getQueryData(familyB)).toEqual([{ title: 'other family' }])
    client.clear()
  })
})
