import type { MemoryReaction, ReactionResponse } from '@web-app-demo/contracts'

export type ReactionWriter = (reaction: MemoryReaction | null) => Promise<ReactionResponse>

export class MemoryReactionQueue {
  private desired: MemoryReaction | null
  private confirmed: MemoryReaction | null
  private counts: ReactionResponse['reactionCounts']
  private pending: Promise<void> | null = null
  private readonly write: ReactionWriter
  private readonly onChange: (desired: MemoryReaction | null, counts: ReactionResponse['reactionCounts'], confirmed: MemoryReaction | null) => void
  private readonly onFailure: () => void

  constructor(
    initialReaction: MemoryReaction | null,
    initialCounts: ReactionResponse['reactionCounts'],
    write: ReactionWriter,
    onChange: (desired: MemoryReaction | null, counts: ReactionResponse['reactionCounts'], confirmed: MemoryReaction | null) => void,
    onFailure: () => void,
  ) {
    this.desired = initialReaction
    this.confirmed = initialReaction
    this.counts = initialCounts
    this.write = write
    this.onChange = onChange
    this.onFailure = onFailure
  }

  submit(reaction: MemoryReaction | null): Promise<void> {
    this.desired = reaction
    this.onChange(reaction, this.counts, this.confirmed)
    if (!this.pending) this.pending = this.drain().finally(() => { this.pending = null })
    return this.pending
  }

  private async drain() {
    let terminalFailure = false
    let forceWrite = false
    while (forceWrite || this.desired !== this.confirmed) {
      const target = this.desired
      forceWrite = false
      try {
        const result = await this.write(target)
        this.confirmed = result.currentUserReaction
        this.counts = result.reactionCounts
        this.onChange(this.desired, this.counts, this.confirmed)
      } catch {
        if (this.desired === target) {
          terminalFailure = true
          this.desired = this.confirmed
          this.onChange(this.confirmed, this.counts, this.confirmed)
          break
        }
        forceWrite = true
      }
    }
    if (terminalFailure) this.onFailure()
  }
}

export function reactionCountsAfterChange(
  counts: ReactionResponse['reactionCounts'],
  confirmed: MemoryReaction | null,
  desired: MemoryReaction | null,
) {
  const next = { ...counts }
  if (confirmed && confirmed !== desired) {
    const remaining = (next[confirmed] ?? 0) - 1
    if (remaining > 0) next[confirmed] = remaining
    else delete next[confirmed]
  }
  if (desired && desired !== confirmed) next[desired] = (next[desired] ?? 0) + 1
  return next
}
