import { describe, expect, test } from 'bun:test'

import { selectLiveTestFiles } from './test-live'

describe('live suite file selection', () => {
  test('fails closed when configured suites match no discovered files', () => {
    const configured = [{ name: 'storage', match: (file) => file.includes('/s3-storage.') }]
    expect(() => selectLiveTestFiles(['src/storage/s3-storage.live.test.ts'], configured)).not.toThrow()
    expect(() => selectLiveTestFiles(['src/storage/storage.test.ts'], configured))
      .toThrow(/matched no discovered test files/)
  })
})
