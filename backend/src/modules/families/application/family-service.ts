import { createHash, createHmac } from 'node:crypto'

import {
  createInviteResponseSchema,
  familyResponseSchema,
} from '@web-app-demo/contracts'
import type {
  AcceptInviteResponse,
  CreateFamilyRequest,
  CreateInviteRequest,
  CreateInviteResponse,
  FamilyDto,
  FamilyMemberDto,
  FamilyMeResponse,
  FamilyResponse,
  InvitePreviewResponse,
  UpdateFamilyRequest,
  UpdateMemberRoleRequest,
} from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { IdempotencyExecutor, JsonObject } from '../../../idempotency'
import { FamilyFailure } from '../domain/errors'
import type { FamilyAccess, FamilyScope, PersistenceErrorClassifier } from './ports'

type Principal = FamilyScope['principal']
type TransactionClient = Parameters<Parameters<DbClient['$transaction']>[0]>[0]

export class FamilyService {
  constructor(
    private readonly db: DbClient,
    private readonly access: FamilyAccess,
    private readonly persistenceErrors: PersistenceErrorClassifier,
    private readonly idempotency: IdempotencyExecutor<TransactionClient>,
    private readonly idempotencySecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getMe(user: {
    id: string
    email: string | null
    displayName: string | null
    role: 'user' | 'admin'
    createdAt: string
  }): Promise<FamilyMeResponse> {
    const membership = await this.db.familyMember.findFirst({
      where: { userId: user.id, revokedAt: null, family: { status: 'active' } },
      include: { family: true },
    })
    return {
      user,
      activeFamily: membership ? {
        id: membership.family.id,
        name: membership.family.name,
        role: membership.role,
        isOwner: membership.family.ownerUserId === user.id,
      } : null,
      limits: { activeFamiliesMaximum: 1 },
    }
  }

  async createFamily(
    principal: Principal,
    input: CreateFamilyRequest,
    idempotencyKey: string,
  ): Promise<FamilyResponse> {
    const payloadHash = hashPayload(input)
    try {
      return (await this.idempotency.run({
        actorUserId: principal.userId,
        operation: 'family.create',
        key: idempotencyKey,
        payloadHash,
        now: this.now(),
        execute: async (tx) => {
          const identity = await tx.externalIdentity.findFirst({
            where: { userId: principal.userId, provider: 'telegram' },
            select: { subject: true },
          })
          const admitted = identity && await tx.pilotAdmission.findFirst({
            where: { provider: 'telegram', subject: identity.subject, revokedAt: null },
            select: { id: true },
          })
          if (!admitted) {
            throw new FamilyFailure('forbidden', 'Создание семьи доступно участникам пилота')
          }

          const existing = await tx.familyMember.findFirst({
            where: { userId: principal.userId, revokedAt: null, family: { status: 'active' } },
            select: { familyId: true },
          })
          if (existing) {
            throw new FamilyFailure('already_in_family', 'Вы уже состоите в активной семье')
          }

          const family = await tx.family.create({
            data: {
              ownerUserId: principal.userId,
              name: input.name,
              timezone: input.timezone,
            },
          })
          await tx.familyMember.create({
            data: { familyId: family.id, userId: principal.userId, role: 'full' },
          })
          const child = await tx.child.create({
            data: {
              familyId: family.id,
              displayName: input.child.displayName,
              birthDate: input.child.birthDate
                ? new Date(`${input.child.birthDate}T00:00:00.000Z`)
                : null,
            },
          })
          const response = { family: familyDto(family), child: childDto(child) }
          return {
            resourceId: family.id,
            response,
            responseSnapshot: response,
          }
        },
        restore: (responseSnapshot) => storedFamilyResponse(responseSnapshot),
        payloadConflict: () => new FamilyFailure(
          'idempotency_conflict',
          'Этот Idempotency-Key уже использован с другими данными',
        ),
      })).response
    } catch (error) {
      if (this.persistenceErrors.isUniqueConstraint(error)) {
        throw new FamilyFailure('already_in_family', 'Вы уже состоите в активной семье')
      }
      throw error
    }
  }

  async updateFamily(scope: FamilyScope, input: UpdateFamilyRequest): Promise<FamilyResponse> {
    await this.access.requireOwner(scope)
    return this.db.$transaction(async (tx) => {
      const family = await tx.family.findFirst({
        where: { id: scope.familyId, status: 'active' },
        include: { children: { take: 1, orderBy: { createdAt: 'asc' } } },
      })
      const child = family?.children[0]
      if (!family || !child) throw new FamilyFailure('not_found', 'Семья не найдена')

      const updatedFamily = await tx.family.update({
        where: { id: family.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        },
      })
      const updatedChild = input.child
        ? await tx.child.update({
            where: { id: child.id },
            data: {
              ...(input.child.displayName === undefined
                ? {}
                : { displayName: input.child.displayName }),
              ...(input.child.birthDate === undefined
                ? {}
                : {
                    birthDate: input.child.birthDate === null
                      ? null
                      : new Date(`${input.child.birthDate}T00:00:00.000Z`),
                  }),
            },
          })
        : child
      return { family: familyDto(updatedFamily), child: childDto(updatedChild) }
    })
  }

  async getFamily(scope: FamilyScope): Promise<FamilyResponse> {
    await this.access.requireMember(scope)
    const family = await this.db.family.findFirst({
      where: { id: scope.familyId, status: 'active' },
      include: { children: { take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!family || !family.children[0]) throw new FamilyFailure('not_found', 'Семья не найдена')
    return { family: familyDto(family), child: childDto(family.children[0]) }
  }

  async listMembers(scope: FamilyScope): Promise<{ items: FamilyMemberDto[] }> {
    await this.access.requireMember(scope)
    const family = await this.db.family.findUnique({
      where: { id: scope.familyId },
      select: { ownerUserId: true },
    })
    if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
    const members = await this.db.familyMember.findMany({
      where: { familyId: scope.familyId, revokedAt: null },
      include: { user: { select: { displayName: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    return {
      items: members.map((member) => memberDto(member, family.ownerUserId)),
    }
  }

  async createInvite(
    scope: FamilyScope,
    input: CreateInviteRequest,
    idempotencyKey: string,
  ): Promise<CreateInviteResponse> {
    await this.access.requireFull(scope)
    const payloadHash = hashPayload(input)
    const operation = `family.invite.create:${scope.familyId}`
    return (await this.idempotency.run({
      actorUserId: scope.principal.userId,
      operation,
      key: idempotencyKey,
      payloadHash,
      now: this.now(),
      execute: async (tx, idempotencyRecordId) => {
        const rawToken = deriveInviteToken(
          this.idempotencySecret,
          scope.principal.userId,
          scope.familyId,
          idempotencyRecordId,
          payloadHash,
        )
        const family = await tx.family.findFirst({
          where: { id: scope.familyId, status: 'active' },
          select: { id: true },
        })
        if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
        const now = this.now()
        const invite = await tx.familyInvite.create({
          data: {
            familyId: scope.familyId,
            role: input.role,
            inviteeDisplayName: input.inviteeDisplayName ?? null,
            tokenHash: hashInviteToken(rawToken),
            createdAt: now,
            expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
            createdBy: scope.principal.userId,
          },
        })
        const response = inviteDto(invite, rawToken)
        return {
          resourceId: invite.id,
          response,
          responseSnapshot: inviteSnapshot(response),
        }
      },
      restore: (responseSnapshot, idempotencyRecordId) => {
        const invite = storedInviteResponse(responseSnapshot)
        return {
          ...invite,
          rawToken: deriveInviteToken(
          this.idempotencySecret,
          scope.principal.userId,
          scope.familyId,
          idempotencyRecordId,
          payloadHash,
          ),
        }
      },
      payloadConflict: () => new FamilyFailure(
        'idempotency_conflict',
        'Этот Idempotency-Key уже использован с другими данными',
      ),
    })).response
  }

  async previewInvite(principal: Principal, rawToken: string): Promise<InvitePreviewResponse> {
    void principal
    const invite = await this.db.familyInvite.findUnique({
      where: { tokenHash: hashInviteToken(rawToken) },
      include: { family: true },
    })
    if (invite?.family.status !== 'active') {
      throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
    }
    assertInviteAvailable(invite, this.now())
    return {
      family: { id: invite.family.id, name: invite.family.name },
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    }
  }

  async acceptInvite(principal: Principal, rawToken: string): Promise<AcceptInviteResponse> {
    const tokenHash = hashInviteToken(rawToken)
    try {
      return await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{
          id: string
          familyId: string
          role: 'full' | 'viewer'
          inviteeDisplayName: string | null
          expiresAt: Date
          acceptedBy: string | null
          revokedAt: Date | null
          familyStatus: 'active' | 'deleting' | 'deleted'
        }>>`
          SELECT i.id,
                 i.family_id AS "familyId",
                 i.role::text AS role,
                 i.invitee_display_name AS "inviteeDisplayName",
                 i.expires_at AS "expiresAt",
                 i.accepted_by AS "acceptedBy",
                 i.revoked_at AS "revokedAt",
                 f.status::text AS "familyStatus"
            FROM family_invites i
            JOIN families f ON f.id = i.family_id
           WHERE i.token_hash = ${tokenHash}
           FOR UPDATE
        `
        const invite = rows[0]
        if (!invite) throw new FamilyFailure('not_found', 'Приглашение не найдено')
        if (invite.familyStatus !== 'active') {
          throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
        }
        if (invite.revokedAt) throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
        if (invite.expiresAt <= this.now()) {
          throw new FamilyFailure('invite_expired', 'Срок действия приглашения истёк')
        }

        if (invite.acceptedBy) {
          if (invite.acceptedBy !== principal.userId) {
            throw new FamilyFailure('invite_used', 'Приглашение уже использовано')
          }
          return inviteResponse(tx, invite.familyId, principal.userId)
        }

        const activeMembership = await tx.familyMember.findFirst({
          where: { userId: principal.userId, revokedAt: null, family: { status: 'active' } },
          select: { familyId: true },
        })
        if (activeMembership && activeMembership.familyId !== invite.familyId) {
          throw new FamilyFailure('already_in_family', 'Вы уже состоите в активной семье')
        }

        if (!activeMembership) {
          await tx.familyMember.upsert({
            where: { familyId_userId: { familyId: invite.familyId, userId: principal.userId } },
            update: {
              role: invite.role,
              familyDisplayName: invite.inviteeDisplayName,
              revokedAt: null,
              joinedAt: this.now(),
            },
            create: {
              familyId: invite.familyId,
              userId: principal.userId,
              role: invite.role,
              familyDisplayName: invite.inviteeDisplayName,
            },
          })
        }
        await tx.familyInvite.update({
          where: { id: invite.id },
          data: { acceptedBy: principal.userId, acceptedAt: this.now() },
        })
        return inviteResponse(tx, invite.familyId, principal.userId)
      })
    } catch (error) {
      if (this.persistenceErrors.isUniqueConstraint(error)) {
        throw new FamilyFailure('already_in_family', 'Вы уже состоите в активной семье')
      }
      throw error
    }
  }

  async revokeInvite(scope: FamilyScope, inviteId: string) {
    const actor = await this.access.requireMember(scope)
    if (!actor.isOwner && actor.role !== 'full') {
      throw new FamilyFailure('forbidden', 'Для этого действия нужен полный доступ')
    }
    const issuerScope = actor.isOwner ? {} : { createdBy: scope.principal.userId }
    const invite = await this.db.familyInvite.findFirst({
      where: { id: inviteId, familyId: scope.familyId, ...issuerScope },
      select: { acceptedAt: true, revokedAt: true },
    })
    if (!invite || invite.acceptedAt) {
      throw new FamilyFailure('not_found', 'Приглашение не найдено')
    }
    if (invite.revokedAt) return

    const result = await this.db.familyInvite.updateMany({
      where: {
        id: inviteId,
        familyId: scope.familyId,
        ...issuerScope,
        revokedAt: null,
        acceptedAt: null,
      },
      data: { revokedAt: this.now() },
    })
    if (result.count === 0) {
      const concurrentlyRevoked = await this.db.familyInvite.findFirst({
        where: { id: inviteId, familyId: scope.familyId, ...issuerScope, revokedAt: { not: null } },
        select: { id: true },
      })
      if (!concurrentlyRevoked) throw new FamilyFailure('not_found', 'Приглашение не найдено')
    }
  }

  async updateMemberRole(scope: FamilyScope, userId: string, input: UpdateMemberRoleRequest) {
    const actor = await this.access.requireMember(scope)
    const family = await this.db.family.findUnique({
      where: { id: scope.familyId },
      select: { ownerUserId: true },
    })
    if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
    if (family.ownerUserId === userId) {
      throw new FamilyFailure('forbidden', 'Создателя семьи нельзя изменять через этот экран')
    }
    if (input.role !== undefined && !actor.isOwner) {
      throw new FamilyFailure('forbidden', 'Уровень доступа меняет только создатель семьи')
    }
    if (input.role === undefined && !actor.isOwner && actor.role !== 'full') {
      throw new FamilyFailure('forbidden', 'Для этого действия нужен полный доступ')
    }
    const updated = await this.db.familyMember.updateMany({
      where: { familyId: scope.familyId, userId, revokedAt: null },
      data: {
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.familyDisplayName === undefined
          ? {}
          : { familyDisplayName: input.familyDisplayName }),
      },
    })
    if (updated.count === 0) throw new FamilyFailure('not_found', 'Участник не найден')
    const member = await this.db.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: scope.familyId, userId } },
      include: { user: { select: { displayName: true } } },
    })
    return { membership: memberDto(member, family.ownerUserId) }
  }

  async removeMember(scope: FamilyScope, userId: string) {
    const removingSelf = scope.principal.userId === userId
    if (removingSelf) {
      const ownMembership = await this.db.familyMember.findUnique({
        where: { familyId_userId: { familyId: scope.familyId, userId } },
        select: { revokedAt: true, family: { select: { status: true } } },
      })
      if (!ownMembership || ownMembership.family.status !== 'active') {
        throw new FamilyFailure('not_found', 'Семья не найдена')
      }
      if (ownMembership.revokedAt) return
      await this.access.requireMember(scope)
    } else {
      await this.access.requireOwner(scope)
    }

    const family = await this.db.family.findUnique({
      where: { id: scope.familyId },
      select: { ownerUserId: true },
    })
    if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
    if (family.ownerUserId === userId) {
      throw new FamilyFailure('conflict', 'Создателя семьи нельзя удалить')
    }
    const member = await this.db.familyMember.findUnique({
      where: { familyId_userId: { familyId: scope.familyId, userId } },
      select: { revokedAt: true },
    })
    if (!member) throw new FamilyFailure('not_found', 'Участник не найден')
    if (member.revokedAt) return

    const revoked = await this.db.familyMember.updateMany({
      where: { familyId: scope.familyId, userId, revokedAt: null },
      data: { revokedAt: this.now() },
    })
    if (revoked.count === 0) {
      const concurrentlyRevoked = await this.db.familyMember.findFirst({
        where: { familyId: scope.familyId, userId, revokedAt: { not: null } },
        select: { userId: true },
      })
      if (!concurrentlyRevoked) throw new FamilyFailure('not_found', 'Участник не найден')
    }
  }

}

function hashInviteToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}

function hashPayload(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function deriveInviteToken(
  secret: string,
  actorUserId: string,
  familyId: string,
  idempotencyRecordId: string,
  payloadHash: string,
) {
  return createHmac('sha256', secret)
    .update(['family-invite-v1', actorUserId, familyId, idempotencyRecordId, payloadHash].join('\0'))
    .digest()
    .subarray(0, 24)
    .toString('base64url')
}

function inviteDto(
  invite: {
    id: string
    role: 'full' | 'viewer'
    inviteeDisplayName: string | null
    expiresAt: Date
  },
  rawToken: string,
): CreateInviteResponse {
  return {
    id: invite.id,
    rawToken,
    role: invite.role,
    inviteeDisplayName: invite.inviteeDisplayName,
    expiresAt: invite.expiresAt.toISOString(),
  }
}

function storedFamilyResponse(responseSnapshot: unknown): FamilyResponse {
  const parsed = familyResponseSchema.safeParse(responseSnapshot)
  if (!parsed.success) unavailableIdempotencyResult()
  return parsed.data
}

const storedInviteResponseSchema = createInviteResponseSchema.omit({ rawToken: true })

function inviteSnapshot(response: CreateInviteResponse): JsonObject {
  return {
    id: response.id,
    role: response.role,
    inviteeDisplayName: response.inviteeDisplayName,
    expiresAt: response.expiresAt,
  }
}

function storedInviteResponse(responseSnapshot: unknown) {
  const parsed = storedInviteResponseSchema.safeParse(responseSnapshot)
  if (!parsed.success) unavailableIdempotencyResult()
  return parsed.data
}

function unavailableIdempotencyResult(): never {
  throw new FamilyFailure('conflict', 'Результат запроса больше недоступен')
}

function familyDto(family: { id: string; name: string; timezone: string; ownerUserId: string }): FamilyDto {
  return {
    id: family.id,
    name: family.name,
    timezone: family.timezone,
    ownerUserId: family.ownerUserId,
  }
}

function childDto(child: { id: string; displayName: string; birthDate: Date | null }) {
  return {
    id: child.id,
    displayName: child.displayName,
    birthDate: child.birthDate?.toISOString().slice(0, 10) ?? null,
  }
}

function memberDto(
  member: {
    userId: string
    role: 'full' | 'viewer'
    familyDisplayName: string | null
    joinedAt: Date
    user: { displayName: string | null }
  },
  ownerUserId: string,
): FamilyMemberDto {
  return {
    userId: member.userId,
    displayName: member.user.displayName,
    familyDisplayName: member.familyDisplayName,
    role: member.role,
    isOwner: member.userId === ownerUserId,
    joinedAt: member.joinedAt.toISOString(),
  }
}

function assertInviteAvailable<T extends {
  acceptedAt: Date | null
  expiresAt: Date
  revokedAt: Date | null
}>(invite: T | null, now: Date): asserts invite is T {
  if (!invite) throw new FamilyFailure('not_found', 'Приглашение не найдено')
  if (invite.revokedAt) throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
  if (invite.expiresAt <= now) throw new FamilyFailure('invite_expired', 'Срок действия приглашения истёк')
  if (invite.acceptedAt) throw new FamilyFailure('invite_used', 'Приглашение уже использовано')
}

async function inviteResponse(
  tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0],
  familyId: string,
  userId: string,
): Promise<AcceptInviteResponse> {
  const family = await tx.family.findUniqueOrThrow({ where: { id: familyId } })
  const member = await tx.familyMember.findFirst({
    where: { familyId, userId, revokedAt: null },
    include: { user: { select: { displayName: true } } },
  })
  if (!member) throw new FamilyFailure('invite_used', 'Приглашение уже использовано')
  return {
    family: familyDto(family),
    membership: memberDto(member, family.ownerUserId),
  }
}
