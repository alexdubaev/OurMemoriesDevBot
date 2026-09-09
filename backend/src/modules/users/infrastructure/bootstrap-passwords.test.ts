import { expect, test } from 'bun:test'

import { createSerialPasswordOperations } from './bootstrap-passwords'

test('bootstrap password hashing never runs two native workers concurrently', async () => {
  let active = 0
  let maximumActive = 0
  const releases: Array<() => void> = []
  const operation = async <T>(result: T) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active -= 1
    return result
  }
  const passwords = createSerialPasswordOperations({
    hash: async (password) => operation(`hash:${password}`),
    verify: async () => operation(true),
  })

  const first = passwords.hash('first')
  const second = passwords.verify('second', 'hash:second')
  await Promise.resolve()
  expect(active).toBe(1)

  releases.shift()?.()
  await first
  await Promise.resolve()
  expect(active).toBe(1)
  releases.shift()?.()

  await expect(second).resolves.toBe(true)
  expect(maximumActive).toBe(1)
})
