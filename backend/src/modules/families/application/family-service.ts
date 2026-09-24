import { createHash, createHmac } from 'node:crypto'

import {
  createInviteResponseSchema,
  familyResponseSchema,
} from '@web-app-demo/contracts'
import type {
  AcceptInviteResponse,
  CompleteChildProfileRequest,
  CreateFamilyRequest,
  CreateInviteRequest,
  CreateInviteResponse,
  FamilyDto,
  FamilyInviteDto,
  FamilyMemberDto,
  FamilyMeResponse,
  FamilyUsage,
  FamilyResponse,
  InvitePreviewResponse,
  UpdateFamilyRequest,
  UpdateMemberRoleRequest,
} from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { IdempotencyExecutor, JsonObject } from '../../../idempotency'
import { insertTask } from '../../../outbox/store'
import { FamilyFailure } from '../domain/errors'
import { isBirthDateOnOrBeforeFamilyToday } from '../domain/family-date'
import type { FamilyAccess, FamilyCreatePrincipal, FamilyScope, PersistenceErrorClassifier } from './ports'

type Principal = FamilyScope['principal']
type TransactionClient = Parameters<Parameters<DbClient['$transaction']>[0]>[0]

export class FamilyService {
  constructor(
    private readonly db: DbClient,
    private readonly access: FamilyAccess,
    private readonly persistenceErrors: PersistenceErrorClassifier,
    private readonly idempotency: IdempotencyExecutor<TransactionClient>,
    private readonly idempotencySecret: string,
    private readonly familyQuotaBytes: number,
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
    principal: FamilyCreatePrincipal,
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
          const admitted = principal.externalIdentity && await tx.pilotAdmission.findFirst({
            where: {
              provider: principal.externalIdentity.provider,
              subject: principal.externalIdentity.subject,
              revokedAt: null,
            },
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
          const response = { family: familyDto(family), child: null }
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
    const transactionResult = await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM families
         WHERE id = ${scope.familyId}::uuid AND status = 'active'
         FOR UPDATE
      `
      if (!locked[0]) throw new FamilyFailure('not_found', 'Семья не найдена')
      const family = await tx.family.findFirst({
        where: { id: scope.familyId, status: 'active' },
        include: { children: { take: 1, orderBy: { createdAt: 'asc' } } },
      })
      const child = family?.children[0]
      if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
      if (input.child && !child) throw new FamilyFailure('not_found', 'Профиль ребёнка не найден')
      const resultingBirthDate = input.child?.birthDate === undefined
        ? child?.birthDate?.toISOString().slice(0, 10)
        : input.child.birthDate
      if (resultingBirthDate && !isBirthDateOnOrBeforeFamilyToday(
        resultingBirthDate,
        input.timezone ?? family.timezone,
        this.now(),
      )) {
        throw new FamilyFailure('conflict', 'Дата рождения не может быть в будущем')
      }

      const avatarMediaId = input.child?.avatarMediaId
      const avatarCrop = input.child?.avatarCrop
      if ((avatarMediaId === undefined) !== (avatarCrop === undefined)) {
        throw new FamilyFailure('conflict', 'Для смены аватара нужны фотография и кадрирование')
      }
      const replacementAvatar = avatarMediaId === undefined ? null : await tx.mediaAsset.findFirst({
        where: {
          id: avatarMediaId,
          familyId: scope.familyId,
          purpose: 'child_avatar',
          mediaKind: 'photo',
          originalStatus: 'stored',
          renditionStatus: 'ready',
          deletedAt: null,
        },
        select: { id: true, width: true, height: true },
      })
      if (avatarMediaId !== undefined && !replacementAvatar) {
        throw new FamilyFailure('conflict', 'Аватар ребёнка должен быть готовым private photo этой семьи')
      }
      if (replacementAvatar && avatarCrop && !isSquarePixelCrop(avatarCrop, replacementAvatar.width, replacementAvatar.height)) {
        throw new FamilyFailure('conflict', 'Кадрирование аватара должно быть квадратным')
      }

      let updatedChild = child
      if (input.child && child) {
        const updated = await tx.child.updateMany({
          where: { id: child.id, version: input.child.expectedVersion },
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
            ...(avatarMediaId === undefined ? {} : { avatarMediaId, avatarCrop }),
            version: { increment: 1 },
          },
        })
        if (updated.count === 0) {
          const photoOnlyUpdate = input.name === undefined
            && input.timezone === undefined
            && input.child.displayName === undefined
            && input.child.birthDate === undefined
            && avatarMediaId !== undefined
          if (photoOnlyUpdate) {
            await retireUnreferencedUploadedAvatar(tx, {
              familyId: scope.familyId,
              mediaId: avatarMediaId,
              uploaderId: scope.principal.userId,
              now: this.now(),
            })
            return { kind: 'version_conflict' as const }
          }
          throw new FamilyFailure('version_conflict', 'Профиль ребёнка изменён другим участником')
        }
        updatedChild = await tx.child.findUniqueOrThrow({ where: { id: child.id } })

        if (avatarMediaId !== undefined && child.avatarMediaId && child.avatarMediaId !== avatarMediaId) {
          const retired = await tx.mediaAsset.updateMany({
            where: {
              id: child.avatarMediaId,
              familyId: scope.familyId,
              purpose: 'child_avatar',
              deletedAt: null,
            },
            data: { deletedAt: this.now() },
          })
          if (retired.count === 1) {
            await insertTask(tx, {
              type: 'media:delete',
              dedupeKey: `media-delete:${child.avatarMediaId}`,
              payload: { mediaId: child.avatarMediaId },
              scheduledFor: this.now(),
            })
          }
        }
      }
      const updatedFamily = input.name === undefined && input.timezone === undefined
        ? family
        : await tx.family.update({
            where: { id: family.id },
            data: {
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
            },
          })
      return {
        kind: 'ok' as const,
        response: { family: familyDto(updatedFamily), child: updatedChild ? childDto(updatedChild) : null },
      }
    })
    if (transactionResult.kind === 'version_conflict') {
      throw new FamilyFailure('version_conflict', 'Профиль ребёнка изменён другим участником')
    }
    return transactionResult.response
  }

  async completeChildProfile(
    scope: FamilyScope,
    input: CompleteChildProfileRequest,
  ): Promise<FamilyResponse> {
    await this.access.requireOwner(scope)
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM families
         WHERE id = ${scope.familyId}::uuid AND status = 'active'
         FOR UPDATE
      `
      if (!locked[0]) throw new FamilyFailure('not_found', 'Семья не найдена')
      const [family, avatar, currentChild] = await Promise.all([
        tx.family.findUniqueOrThrow({ where: { id: scope.familyId } }),
        tx.mediaAsset.findFirst({
          where: {
            id: input.avatarMediaId,
            familyId: scope.familyId,
            purpose: 'child_avatar',
            mediaKind: 'photo',
            originalStatus: 'stored',
            renditionStatus: 'ready',
            deletedAt: null,
          },
          select: { id: true, width: true, height: true },
        }),
        tx.child.findFirst({ where: { familyId: scope.familyId }, orderBy: { createdAt: 'asc' } }),
      ])
      if (!avatar) {
        throw new FamilyFailure('conflict', 'Аватар ребёнка должен быть готовым private photo этой семьи')
      }
      if (!isBirthDateOnOrBeforeFamilyToday(input.birthDate, family.timezone, this.now())) {
        throw new FamilyFailure('conflict', 'Дата рождения не может быть в будущем')
      }
      if (!isSquarePixelCrop(input.avatarCrop, avatar.width, avatar.height)) {
        throw new FamilyFailure('conflict', 'Кадрирование аватара должно быть квадратным')
      }
      const data = {
        displayName: input.name,
        birthDate: new Date(`${input.birthDate}T00:00:00.000Z`),
        sex: input.sex,
        avatarMediaId: input.avatarMediaId,
        avatarCrop: input.avatarCrop,
      }
      let child
      if (currentChild) {
        if (input.expectedVersion === null) {
          throw new FamilyFailure('version_conflict', 'Для изменения профиля нужна его текущая версия')
        }
        const updated = await tx.child.updateMany({
          where: { id: currentChild.id, version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        })
        if (updated.count === 0) {
          throw new FamilyFailure('version_conflict', 'Профиль ребёнка изменён другим участником')
        }
        child = await tx.child.findUniqueOrThrow({ where: { id: currentChild.id } })
      } else {
        if (input.expectedVersion !== null) {
          throw new FamilyFailure('version_conflict', 'Профиль ребёнка ещё не создан')
        }
        child = await tx.child.create({ data: { familyId: scope.familyId, ...data } })
      }

      if (currentChild?.avatarMediaId && currentChild.avatarMediaId !== input.avatarMediaId) {
        const retired = await tx.mediaAsset.updateMany({
          where: {
            id: currentChild.avatarMediaId,
            familyId: scope.familyId,
            purpose: 'child_avatar',
            deletedAt: null,
          },
          data: { deletedAt: this.now() },
        })
        if (retired.count === 1) {
          await insertTask(tx, {
            type: 'media:delete',
            dedupeKey: `media-delete:${currentChild.avatarMediaId}`,
            payload: { mediaId: currentChild.avatarMediaId },
            scheduledFor: this.now(),
          })
        }
      }
      return { family: familyDto(family), child: childDto(child) }
    })
  }

  async getFamily(scope: FamilyScope): Promise<FamilyResponse> {
    await this.access.requireMember(scope)
    const family = await this.db.family.findFirst({
      where: { id: scope.familyId, status: 'active' },
      include: { children: { take: 1, orderBy: { createdAt: 'asc' } } },
    })
    if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
    return { family: familyDto(family), child: family.children[0] ? childDto(family.children[0]) : null }
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
        const issuer = await tx.$queryRaw<Array<{ role: 'full' | 'viewer' }>>`
          SELECT role::text AS role
            FROM family_members
           WHERE family_id = ${scope.familyId}::uuid
             AND user_id = ${scope.principal.userId}::uuid
             AND revoked_at IS NULL
           FOR UPDATE
        `
        if (!issuer[0]) throw new FamilyFailure('not_found', 'Семья не найдена')
        if (issuer[0].role !== 'full') {
          throw new FamilyFailure('forbidden', 'Для этого действия нужен полный доступ')
        }
        const rawToken = deriveInviteToken(
          this.idempotencySecret,
          scope.principal.userId,
          scope.familyId,
          idempotencyRecordId,
          payloadHash,
        )
        const family = await tx.family.findFirst({
          where: { id: scope.familyId, status: 'active' },
          select: { id: true, children: { select: { displayName: true, birthDate: true, sex: true, avatarMediaId: true, avatarCrop: true }, take: 1 } },
        })
        if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
        if (!family.children[0] || !isCompletedChild(family.children[0])) {
          throw new FamilyFailure('conflict', 'Сначала завершите профиль ребёнка')
        }
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

  async getUsage(scope: FamilyScope): Promise<FamilyUsage> {
    await this.access.requireMember(scope)
    const family = await this.db.family.findFirst({ where: { id: scope.familyId, status: 'active' }, select: { storageUsedBytes: true } })
    if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
    return { usedBytes: Number(family.storageUsedBytes), quotaBytes: this.familyQuotaBytes }
  }

  async listInvites(scope: FamilyScope): Promise<{ items: FamilyInviteDto[] }> {
    const actor = await this.access.requireMember(scope)
    if (!actor.isOwner && actor.role !== 'full') {
      throw new FamilyFailure('forbidden', 'Для просмотра приглашений нужен полный доступ')
    }
    const invites = await this.db.familyInvite.findMany({
      where: {
        familyId: scope.familyId,
        acceptedAt: null,
        revokedAt: null,
        ...(actor.isOwner ? {} : { createdBy: scope.principal.userId }),
      },
      orderBy: { createdAt: 'desc' },
    })
    return { items: invites.map(pendingInviteDto) }
  }

  async previewInvite(principal: Principal, rawToken: string): Promise<InvitePreviewResponse> {
    const invite = await this.db.familyInvite.findUnique({
      where: { tokenHash: hashInviteToken(rawToken) },
      include: { family: true },
    })
    if (!invite) throw new FamilyFailure('not_found', 'Приглашение не найдено')
    if (invite.family.status !== 'active') throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
    if (invite.revokedAt) throw new FamilyFailure('invite_revoked', 'Приглашение отозвано')
    if (invite.acceptedAt) {
      const acceptedByCurrentMember = invite.acceptedBy === principal.userId && await this.db.familyMember.findFirst({
        where: {
          familyId: invite.familyId,
          userId: principal.userId,
          revokedAt: null,
          family: { status: 'active' },
        },
        select: { userId: true },
      })
      if (!acceptedByCurrentMember) {
        throw new FamilyFailure('invite_used', 'Приглашение уже использовано')
      }
    } else if (invite.expiresAt <= this.now()) {
      throw new FamilyFailure('invite_expired', 'Срок действия приглашения истёк')
    }
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
        if (invite.acceptedBy) {
          if (invite.acceptedBy !== principal.userId) {
            throw new FamilyFailure('invite_used', 'Приглашение уже использовано')
          }
          return inviteResponse(tx, invite.familyId, principal.userId)
        }
        if (invite.expiresAt <= this.now()) {
          throw new FamilyFailure('invite_expired', 'Срок действия приглашения истёк')
        }

        const activeMembership = await tx.familyMember.findFirst({
          where: { userId: principal.userId, revokedAt: null, family: { status: 'active' } },
          select: { familyId: true },
        })
        if (activeMembership && activeMembership.familyId !== invite.familyId) {
          throw new FamilyFailure('already_in_family', 'Вы уже состоите в активной семье')
        }
        if (activeMembership?.familyId === invite.familyId) {
          return inviteResponse(tx, invite.familyId, principal.userId)
        }

        if (!activeMembership) {
          await tx.familyMember.upsert({
            where: { familyId_userId: { familyId: invite.familyId, userId: principal.userId } },
            update: {
              role: invite.role,
              familyDisplayName: invite.inviteeDisplayName,
              revokedAt: null,
              joinedAt: this.now(),
              version: { increment: 1 },
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
    if (input.role !== undefined && !actor.isOwner) {
      throw new FamilyFailure('forbidden', 'Уровень доступа меняет только создатель семьи')
    }
    if (input.role === undefined && !actor.isOwner && actor.role !== 'full') {
      throw new FamilyFailure('forbidden', 'Для этого действия нужен полный доступ')
    }
    return this.db.$transaction(async (tx) => {
      const family = await tx.family.findUnique({
        where: { id: scope.familyId }, select: { ownerUserId: true },
      })
      if (!family) throw new FamilyFailure('not_found', 'Семья не найдена')
      if (family.ownerUserId === userId) {
        throw new FamilyFailure('forbidden', 'Создателя семьи нельзя изменять через этот экран')
      }
      const updated = await tx.familyMember.updateMany({
        where: { familyId: scope.familyId, userId, revokedAt: null, version: input.expectedVersion },
        data: {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.familyDisplayName === undefined
            ? {}
          : { familyDisplayName: input.familyDisplayName }),
          version: { increment: 1 },
        },
      })
      if (updated.count === 0) {
        const exists = await tx.familyMember.count({ where: { familyId: scope.familyId, userId, revokedAt: null } })
        if (exists) throw new FamilyFailure('version_conflict', 'Данные участника изменены другим пользователем')
        throw new FamilyFailure('not_found', 'Участник не найден')
      }
      if (input.role === 'viewer') {
        await tx.familyInvite.updateMany({
          where: { familyId: scope.familyId, createdBy: userId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: this.now() },
        })
      }
      const member = await tx.familyMember.findUniqueOrThrow({
        where: { familyId_userId: { familyId: scope.familyId, userId } },
        include: { user: { select: { displayName: true } } },
      })
      return { membership: memberDto(member, family.ownerUserId) }
    })
  }

  async removeMember(scope: FamilyScope, userId: string, expectedVersion: number) {
    const removingSelf = scope.principal.userId === userId
    if (removingSelf) {
      const ownMembership = await this.db.familyMember.findUnique({
        where: { familyId_userId: { familyId: scope.familyId, userId } },
        select: { revokedAt: true, version: true, family: { select: { status: true } } },
      })
      if (!ownMembership || ownMembership.family.status !== 'active') {
        throw new FamilyFailure('not_found', 'Семья не найдена')
      }
      if (ownMembership.revokedAt) {
        if (ownMembership.version === expectedVersion + 1) return
        throw new FamilyFailure('version_conflict', 'Данные участника изменены другим пользователем')
      }
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
      select: { revokedAt: true, version: true },
    })
    if (!member) throw new FamilyFailure('not_found', 'Участник не найден')
    if (member.revokedAt) {
      if (member.version === expectedVersion + 1) return
      throw new FamilyFailure('version_conflict', 'Данные участника изменены другим пользователем')
    }

    await this.db.$transaction(async (tx) => {
      const revoked = await tx.familyMember.updateMany({
        where: { familyId: scope.familyId, userId, revokedAt: null, version: expectedVersion },
        data: { revokedAt: this.now(), version: { increment: 1 } },
      })
      if (revoked.count === 0) {
        const currentMember = await tx.familyMember.findUnique({
          where: { familyId_userId: { familyId: scope.familyId, userId } },
          select: { revokedAt: true, version: true },
        })
        if (!currentMember) throw new FamilyFailure('not_found', 'Участник не найден')
        if (currentMember.revokedAt && currentMember.version === expectedVersion + 1) return
        throw new FamilyFailure('version_conflict', 'Данные участника изменены другим пользователем')
      }
      await tx.familyInvite.updateMany({
        where: { familyId: scope.familyId, createdBy: userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: this.now() },
      })
    })
  }

}

function hashInviteToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}

async function retireUnreferencedUploadedAvatar(
  tx: TransactionClient,
  input: { familyId: string; mediaId: string; uploaderId: string; now: Date },
) {
  const referencedChild = await tx.child.findFirst({
    where: { familyId: input.familyId, avatarMediaId: input.mediaId },
    select: { id: true },
  })
  if (referencedChild) return

  const retired = await tx.mediaAsset.updateMany({
    where: {
      id: input.mediaId,
      familyId: input.familyId,
      uploaderId: input.uploaderId,
      sourceKind: 'upload',
      purpose: 'child_avatar',
      mediaKind: 'photo',
      originalStatus: 'stored',
      deletedAt: null,
      storageDeletedAt: null,
    },
    data: { deletedAt: input.now },
  })
  if (retired.count !== 1) return

  await insertTask(tx, {
    type: 'media:delete',
    dedupeKey: `media-delete:${input.mediaId}`,
    payload: { mediaId: input.mediaId },
    scheduledFor: input.now,
  })
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

function childDto(child: {
  id: string
  displayName: string
  birthDate: Date | null
  sex: string | null
  avatarMediaId: string | null
  avatarCrop: unknown
  version: number
}) {
  const sex: 'boy' | 'girl' | null = child.sex === 'boy' || child.sex === 'girl' ? child.sex : null
  const avatarCrop = validAvatarCrop(child.avatarCrop) ? child.avatarCrop : null
  return {
    id: child.id,
    name: child.displayName,
    birthDate: child.birthDate?.toISOString().slice(0, 10) ?? null,
    sex,
    avatarMediaId: child.avatarMediaId,
    avatarCrop,
    version: child.version,
    isComplete: child.displayName.trim().length > 0 && child.birthDate !== null && sex !== null && child.avatarMediaId !== null && avatarCrop !== null,
  }
}

function isCompletedChild(child: { displayName: string; birthDate: Date | null; sex: string | null; avatarMediaId: string | null; avatarCrop: unknown }) {
  return child.displayName.trim().length > 0 && child.birthDate !== null &&
    (child.sex === 'boy' || child.sex === 'girl') && child.avatarMediaId !== null && validAvatarCrop(child.avatarCrop)
}

function isSquarePixelCrop(crop: { x: number; y: number; width: number; height: number }, width: number | null, height: number | null) {
  if (!width || !height) return false
  return Math.abs(crop.width * width - crop.height * height) < 0.01
}

function pendingInviteDto(invite: {
  id: string
  role: 'full' | 'viewer'
  inviteeDisplayName: string | null
  expiresAt: Date
  createdAt: Date
}): FamilyInviteDto {
  return {
    id: invite.id,
    role: invite.role,
    inviteeDisplayName: invite.inviteeDisplayName,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }
}

function validAvatarCrop(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const crop = value as Record<string, unknown>
  const [x, y, width, height] = [crop.x, crop.y, crop.width, crop.height]
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return false
  }
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1
}

function memberDto(
  member: {
    userId: string
    role: 'full' | 'viewer'
    familyDisplayName: string | null
    joinedAt: Date
    version: number
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
    version: member.version,
  }
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
