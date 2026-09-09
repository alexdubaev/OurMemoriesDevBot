type PasswordHasher = (password: string) => Promise<string>
type PasswordVerifier = (password: string, hash: string) => Promise<boolean>

export function createSerialPasswordOperations({
  hash,
  verify,
}: {
  hash: PasswordHasher
  verify: PasswordVerifier
}) {
  let tail = Promise.resolve()

  const schedule = <T>(operation: () => Promise<T>) => {
    const result = tail.then(operation)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    hash: (password: string) => schedule(() => hash(password)),
    verify: (password: string, passwordHash: string) =>
      schedule(() => verify(password, passwordHash)),
  }
}

const bootstrapPasswordOperations = createSerialPasswordOperations({
  hash: (password) => Bun.password.hash(password, { algorithm: 'argon2id' }),
  verify: (password, passwordHash) => Bun.password.verify(password, passwordHash),
})

export const hashBootstrapPassword = bootstrapPasswordOperations.hash
export const verifyBootstrapPassword = bootstrapPasswordOperations.verify
