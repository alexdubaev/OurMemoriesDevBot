export type CaptionReply = {
  familyId: string
  userId: string
  chatId: string
  replyToMessageId: string | null
  text: string
}

export type CaptionRepository = {
  consumeReply(input: Required<CaptionReply>): Promise<{ kind: 'updated' | 'not_found' | 'expired' | 'forbidden' | 'stale' }>
  cancel(input: { familyId: string; userId: string; chatId: string }): Promise<boolean>
}

/** Explicit reply association prevents arbitrary following text from mutating a memory caption. */
export class CaptionService {
  constructor(private readonly repository: CaptionRepository) {}

  async consumeReply(input: CaptionReply) {
    if (!input.replyToMessageId) return { kind: 'not_applicable' as const }
    return this.repository.consumeReply({ ...input, replyToMessageId: input.replyToMessageId })
  }

  async cancel(input: { familyId: string; userId: string; chatId: string }) {
    return this.repository.cancel(input)
  }
}
