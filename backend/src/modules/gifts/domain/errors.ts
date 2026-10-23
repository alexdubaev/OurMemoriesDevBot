export type GiftFailureKind =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'invalid_input'

export class GiftFailure extends Error {
  constructor(public readonly kind: GiftFailureKind, message: string) {
    super(message)
    this.name = 'GiftFailure'
  }
}
