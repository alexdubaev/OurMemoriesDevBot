import type { CreateGiftRequest, GiftDto, UpdateGiftRequest } from '@web-app-demo/contracts'
import type { DbClient } from '../../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../../idempotency'
import { insertTask } from '../../../outbox/store'
import type { FamilyScope } from '../../families'
import type { GiftIdempotency, GiftRepository } from '../application/ports'
import { GiftFailure } from '../domain/errors'
import {
  assertMayEditGifts,
  type GiftActor,
  type GiftReservationState,
  type ReservationDecision,
} from '../domain/gift-rules'

type GiftRow = {
  id: string
  familyId: string
  childId: string
  title: string
  url: string
  price: string | null
  photoMediaId: string
  createdByUserId: string
  reservedByUserId: string | null
  reservedAt: Date | null
  boughtAt: Date | null
  version: number
  createdAt: Date
  updatedAt: Date
}

const missing = () => new GiftFailure('not_found', 'Подарок не найден')
const missingFamily = () => new GiftFailure('not_found', 'Семья не найдена')
const versionConflict = () => new GiftFailure('version_conflict', 'Подарок изменён другим участником')
const idempotencyConflict = () =>
  new GiftFailure('idempotency_conflict', 'Этот Idempotency-Key уже использован или подарок удалён')
const photoUnavailable = () => new GiftFailure('invalid_input', 'Фото подарка недоступно — загрузите его заново')

export class PrismaGiftRepository implements GiftRepository {
  constructor(
    private readonly db: DbClient,
    private readonly idempotency: IdempotencyExecutor<PrismaTransactionClient>,
  ) {}

  async list(scope: FamilyScope) {
    return this.db.$transaction(async (tx) => {
      await lockScope(tx, scope)
      const child = await tx.child.findFirst({
        where: { familyId: scope.familyId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
      if (!child) return []
      const rows = await tx.gift.findMany({ where: { familyId: scope.familyId, childId: child.id } })
      const open = rows.filter((row) => !row.boughtAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      const bought = rows.filter((row) => row.boughtAt)
        .sort((a, b) => b.boughtAt!.getTime() - a.boughtAt!.getTime() || b.id.localeCompare(a.id))
      return project(tx, scope, [...open, ...bought])
    })
  }

  async create(scope: FamilyScope, input: CreateGiftRequest, idempotency: GiftIdempotency, maxActiveGifts: number) {
    const result = await this.idempotency.run({
      actorUserId: scope.principal.userId,
      operation: `gift.create:${scope.familyId}`,
      key: idempotency.key,
      payloadHash: idempotency.payloadHash,
      now: idempotency.now,
      execute: async (tx) => {
        assertMayEditGifts(await lockScope(tx, scope))
        const children = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM children WHERE family_id=${scope.familyId}::uuid AND deleted_at IS NULL
          ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE`
        const childId = children[0]?.id
        if (!childId) throw new GiftFailure('conflict', 'Сначала заполните профиль ребёнка')
        await lockGiftPhoto(tx, scope, input.photoMediaId)
        const active = await tx.gift.count({ where: { familyId: scope.familyId, childId, boughtAt: null } })
        if (active >= maxActiveGifts)
          throw new GiftFailure('invalid_input', `В списке уже ${maxActiveGifts} подарков — удалите ненужные`)
        const row = await tx.gift.create({
          data: {
            familyId: scope.familyId,
            childId,
            title: input.title,
            url: input.url,
            price: input.price ?? null,
            photoMediaId: input.photoMediaId,
            createdByUserId: scope.principal.userId,
          },
          select: { id: true },
        })
        return { resourceId: row.id, response: { giftId: row.id }, responseSnapshot: { giftId: row.id } }
      },
      restore: (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object' || !('giftId' in snapshot) || typeof snapshot.giftId !== 'string')
          throw idempotencyConflict()
        return { giftId: snapshot.giftId }
      },
      payloadConflict: idempotencyConflict,
    })
    // The snapshot holds only the id. Replays read fresh data under the same locks as a list.
    return this.db.$transaction(async (tx) => {
      await lockScope(tx, scope)
      const row = await tx.gift.findFirst({ where: { id: result.response.giftId, familyId: scope.familyId } })
      if (!row) throw idempotencyConflict()
      const [gift] = await project(tx, scope, [row])
      return { gift: gift!, replayed: result.replayed }
    })
  }

  async update(scope: FamilyScope, giftId: string, input: UpdateGiftRequest, now: Date) {
    return this.db.$transaction(async (tx) => {
      assertMayEditGifts(await lockScope(tx, scope))
      const row = await lockGift(tx, scope, giftId)
      if (row.version !== input.expectedVersion) throw versionConflict()
      const replacesPhoto = input.photoMediaId !== undefined && input.photoMediaId !== row.photoMediaId
      if (replacesPhoto) await lockGiftPhoto(tx, scope, input.photoMediaId!)
      const changed = await tx.gift.updateMany({
        where: { id: giftId, familyId: scope.familyId, version: input.expectedVersion },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(replacesPhoto ? { photoMediaId: input.photoMediaId } : {}),
          version: { increment: 1 },
        },
      })
      if (!changed.count) throw versionConflict()
      if (replacesPhoto) await retirePhoto(tx, scope, row.photoMediaId, now)
      const [gift] = await project(tx, scope, [await tx.gift.findUniqueOrThrow({ where: { id: giftId } })])
      return gift!
    })
  }

  async remove(scope: FamilyScope, giftId: string, expectedVersion: number, now: Date) {
    await this.db.$transaction(async (tx) => {
      assertMayEditGifts(await lockScope(tx, scope))
      const row = await lockGift(tx, scope, giftId)
      if (row.version !== expectedVersion) throw versionConflict()
      const removed = await tx.gift.deleteMany({ where: { id: giftId, familyId: scope.familyId, version: expectedVersion } })
      if (!removed.count) throw versionConflict()
      await retirePhoto(tx, scope, row.photoMediaId, now)
    })
  }

  async changeReservation(
    scope: FamilyScope,
    giftId: string,
    decide: (gift: GiftReservationState, actor: GiftActor) => ReservationDecision,
  ) {
    return this.db.$transaction(async (tx) => {
      const actor = await lockScope(tx, scope)
      const row = await lockGift(tx, scope, giftId)
      const reservedByName = row.reservedByUserId
        ? (await memberNames(tx, scope, [row.reservedByUserId])).get(row.reservedByUserId) ?? null
        : null
      const decision = decide({
        version: row.version,
        reservedByUserId: row.reservedByUserId,
        reservedByName,
        reservedAt: row.reservedAt,
        boughtAt: row.boughtAt,
      }, actor)
      let current: GiftRow = row
      if (decision) {
        const changed = await tx.gift.updateMany({
          where: { id: giftId, familyId: scope.familyId, version: row.version },
          data: { ...decision, version: { increment: 1 } },
        })
        if (!changed.count) throw versionConflict()
        current = await tx.gift.findUniqueOrThrow({ where: { id: giftId } })
      }
      const [gift] = await project(tx, scope, [current])
      return gift!
    })
  }
}

/**
 * Shares the user, the active family and the live membership for the whole transaction, so a
 * concurrent member removal either waits for this change or makes it fail with 404.
 */
async function lockScope(tx: PrismaTransactionClient, scope: FamilyScope): Promise<GiftActor> {
  const user = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id=${scope.principal.userId}::uuid FOR SHARE`
  if (!user.length) throw missingFamily()
  const family = await tx.$queryRaw<Array<{ owner_user_id: string }>>`
    SELECT owner_user_id FROM families WHERE id=${scope.familyId}::uuid AND status='active' FOR SHARE`
  if (!family.length) throw missingFamily()
  const member = await tx.$queryRaw<Array<{ role: 'full' | 'viewer' }>>`
    SELECT role::text AS role FROM family_members
    WHERE family_id=${scope.familyId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL FOR SHARE`
  if (!member.length) throw missingFamily()
  return {
    userId: scope.principal.userId,
    role: member[0]!.role,
    isOwner: family[0]!.owner_user_id === scope.principal.userId,
  }
}

async function lockGift(tx: PrismaTransactionClient, scope: FamilyScope, giftId: string): Promise<GiftRow> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM gifts WHERE id=${giftId}::uuid AND family_id=${scope.familyId}::uuid FOR UPDATE`
  if (!locked.length) throw missing()
  return tx.gift.findUniqueOrThrow({ where: { id: giftId } })
}

/** A gift photo must be this family's stored, live `gift` upload that no other gift uses. */
async function lockGiftPhoto(tx: PrismaTransactionClient, scope: FamilyScope, mediaId: string) {
  const assets = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM media_assets
    WHERE id=${mediaId}::uuid AND family_id=${scope.familyId}::uuid AND purpose='gift'
      AND media_kind='photo' AND original_status='stored' AND deleted_at IS NULL
    FOR UPDATE`
  if (!assets.length) throw photoUnavailable()
  if (await tx.gift.findFirst({ where: { photoMediaId: mediaId }, select: { id: true } })) throw photoUnavailable()
}

async function retirePhoto(tx: PrismaTransactionClient, scope: FamilyScope, mediaId: string, now: Date) {
  const retired = await tx.mediaAsset.updateMany({
    where: { id: mediaId, familyId: scope.familyId, deletedAt: null },
    data: { deletedAt: now },
  })
  if (!retired.count) return
  await insertTask(tx, {
    type: 'media:delete',
    dedupeKey: `media-delete:${mediaId}`,
    payload: { mediaId },
    scheduledFor: now,
  })
}

/** Names as the family members list shows them; revoked members keep their name on bought gifts. */
async function memberNames(tx: PrismaTransactionClient, scope: FamilyScope, userIds: string[]) {
  const members = await tx.familyMember.findMany({
    where: { familyId: scope.familyId, userId: { in: [...new Set(userIds)] } },
    select: { userId: true, familyDisplayName: true, user: { select: { displayName: true } } },
  })
  return new Map(members.map((member) => [
    member.userId,
    member.familyDisplayName?.trim() || member.user.displayName?.trim() || 'Участник семьи',
  ]))
}

async function project(tx: PrismaTransactionClient, scope: FamilyScope, rows: GiftRow[]): Promise<GiftDto[]> {
  if (!rows.length) return []
  const names = await memberNames(tx, scope, rows.flatMap((row) =>
    row.reservedByUserId ? [row.createdByUserId, row.reservedByUserId] : [row.createdByUserId]))
  const nameOf = (userId: string) => names.get(userId) ?? 'Участник семьи'
  return rows.map((row) => ({
    id: row.id,
    childId: row.childId,
    title: row.title,
    url: row.url,
    price: row.price,
    photoMediaId: row.photoMediaId,
    createdBy: { userId: row.createdByUserId, name: nameOf(row.createdByUserId) },
    reservation: row.reservedByUserId && row.reservedAt
      ? {
          userId: row.reservedByUserId,
          name: nameOf(row.reservedByUserId),
          reservedAt: row.reservedAt.toISOString(),
          boughtAt: row.boughtAt?.toISOString() ?? null,
        }
      : null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}
