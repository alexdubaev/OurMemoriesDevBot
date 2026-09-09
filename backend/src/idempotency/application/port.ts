export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type IdempotencyExecutionResult<Result> = {
  resourceId: string
  response: Result
  responseSnapshot: JsonObject
}

export type IdempotencyRunOptions<Transaction, Result> = {
  actorUserId: string
  operation: string
  key: string
  payloadHash: string
  now: Date
  execute(
    transaction: Transaction,
    idempotencyRecordId: string,
  ): Promise<IdempotencyExecutionResult<Result>>
  restore(responseSnapshot: unknown, idempotencyRecordId: string): Result
  payloadConflict(): Error
}

export type IdempotencyExecutor<Transaction> = {
  run<Result>(
    options: IdempotencyRunOptions<Transaction, Result>,
  ): Promise<{ response: Result; replayed: boolean }>
}
