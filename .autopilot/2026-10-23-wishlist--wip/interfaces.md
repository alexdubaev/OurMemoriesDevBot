# Интерфейсы и правила проекта

Читать первым. Здесь границы между частями сборки, правила проекта и (дописывается по ходу) то, что построили завершённые таски.

## Правила проекта (из AGENTS.md и брифа)

- Только MAX Mini App и Web/PWA с MAX-авторизацией. Telegram-код не трогать и не удалять.
- Стек: Bun 1.4 / Hono (OpenAPIHono) / Prisma; React/Vite; контракты zod в `packages/contracts`. Модульный монолит: файлы модуля только в `domain|application|infrastructure|transport`, чужой модуль — только через его `index.ts`, `application`/`domain` не импортируют prisma, hono, env (`bun run architecture:check`).
- Имена в коде — по-английски. Русский — только в текстах интерфейса (пишутся прямо в TSX) и комментариях.
- Иконки — только WebP RGBA через `WebpIcon`; никаких SVG, inline SVG, icon-font, Lucide/Hugeicons.
- Применённые миграции не править. Новая миграция пишется SQL руками, аддитивно.
- Тесты: bun:test. Интеграционные `*.integration.test.ts` требуют PostgreSQL (Docker Compose поднимает runner сам или `TEST_DATABASE_URL` с базой `*_test` + `TEST_SKIP_DOCKER=1`). Только синтетические данные.
- Не делать push, merge, деплой, изменение production-данных. Не коммитить — коммитит оркестратор.
- Код из проектов в `reference.md` не копировать.
- Фото и тексты пользователей не выдумывать; в тестах — синтетика.

## Команда проверки

Полная: `bun run typecheck && bun run lint && bun run architecture:check && bun run test:contracts && bun run test:backend:unit && bun run test:webapp`
Интеграционные backend: `bun run test:backend:integration -- <файл>` (нужен Docker).
Один файл: `bun test packages/contracts/src/gifts.test.ts` · `bun run test:backend:unit -- <файл>` · `cd webapp && bun test tests/<файл>`.
Сборка веба: `bun run build:webapp`.

## Границы, решённые в спецификации

### 1. Контракты — `packages/contracts/src/gifts.ts` (+ `export * from './gifts'` в `src/index.ts`)

Все объекты `.strict()`.

```ts
giftTitleSchema       = z.string().trim().min(1).max(120)
giftUrlSchema         = z.string().max(2048)  // refine: new URL() ok, protocol http: | https:, без username/password
giftPriceSchema       = z.string().trim().min(1).max(30)   // как ввёл родитель, без привязки к оплате
giftsParamsSchema     = { familyId: uuid }
giftParamsSchema      = { familyId: uuid, giftId: uuid }

giftReservationDtoSchema = {
  userId: uuid, name: string, reservedAt: iso, boughtAt: iso | null
}
giftDtoSchema = {
  id: uuid, childId: uuid, title, url, price: string | null,
  photoMediaId: uuid,
  createdBy: { userId: uuid, name: string },
  reservation: giftReservationDtoSchema | null,
  version: int, createdAt: iso, updatedAt: iso
}
giftListResponseSchema    = { gifts: giftDtoSchema[] }   // некупленные createdAt desc, затем купленные boughtAt desc
createGiftRequestSchema   = { title, url, price?: string, photoMediaId: uuid }   // header Idempotency-Key (idempotencyKeyHeadersSchema)
updateGiftRequestSchema   = { expectedVersion: int, title?, url?, price?: string | null, photoMediaId?: uuid }
giftVersionRequestSchema  = { expectedVersion: int }      // бронь, снятие, куплено, отмена куплено
deleteGiftHeadersSchema   = ifMatchVersionHeadersSchema
giftMutationResponseSchema = { gift: giftDtoSchema }
export const MAX_ACTIVE_GIFTS = 200
```

`media.ts`: `mediaPurposeSchema = z.enum(['memory', 'child_avatar', 'gift'])`. Коды ошибок — существующие (`NOT_FOUND`, `ROLE_FORBIDDEN`, `CONFLICT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_INPUT`); новых не добавлять без нужды.

### 2. HTTP — все под `/api/v1`, `security: BearerAuth`, `requireAuth`

| Метод и путь | Право | Ответ |
|---|---|---|
| `GET /families/{familyId}/gifts` | member | 200 `giftListResponseSchema` |
| `POST /families/{familyId}/gifts` | full | 201 / 200 при повторе ключа, `giftMutationResponseSchema` |
| `PATCH /families/{familyId}/gifts/{giftId}` | full | 200 `giftMutationResponseSchema` |
| `DELETE /families/{familyId}/gifts/{giftId}` (If-Match) | full | 204 |
| `POST /families/{familyId}/gifts/{giftId}/reservation` | member | 200; занято другим → 409 `CONFLICT`; уже моё → 200 без изменений |
| `DELETE /families/{familyId}/gifts/{giftId}/reservation` (body `expectedVersion`) | забронировавший или владелец | 200; куплено → 409 `CONFLICT` |
| `POST /families/{familyId}/gifts/{giftId}/purchase` | забронировавший | 200 |
| `DELETE /families/{familyId}/gifts/{giftId}/purchase` | забронировавший | 200 |

Ошибки валидации — 422 (`validationErrorHook` по умолчанию). Чужая семья или чужой подарок — 404. `Cache-Control: private, no-store` на всех `/gifts` (аналог `commentPrivacyMiddleware`).

### 3. Backend-модуль `backend/src/modules/gifts`

- **Владеет:** таблицей `gifts`, правилами подарков и брони.
- **Выставляет:** `createGiftsModule({ db, familyAccess, idempotencyExecutor, idempotencySecret, requireAuth, now? }) → { routes }`; монтируется в `app.ts` как `app.route('/api/v1', gifts.routes)` рядом с memories.
- **Внутри:** `domain/errors.ts` (`GiftFailure` с `kind`), `application/gift-service.ts` (`list`, `create`, `update`, `remove`, `reserve`, `cancelReservation`, `markBought`, `unmarkBought`), `application/ports.ts` (`GiftRepository`), `infrastructure/prisma-gift-repository.ts`, `transport/routes.ts`, `transport/errors.ts`.
- **Скрывает:** SQL, блокировки (`lockScope` как в комментариях), идемпотентность создания (`operation: 'gift.create:<familyId>'`).
- Создание проверяет: фото — `MediaAsset` этой семьи, `purpose = 'gift'`, `originalStatus = stored`, не занято другим подарком; ребёнок — первый ребёнок семьи (`children take 1 orderBy createdAt asc`); лимит `MAX_ACTIVE_GIFTS` некупленных.
- Удаление и замена фото: старый `MediaAsset` → `deletedAt` + `insertTask(tx, { type: 'media:delete', dedupeKey: 'media-delete:<id>', payload: { mediaId } })` в той же транзакции.

### 4. Схема — `backend/prisma/schema.prisma` + миграция `20261023120000_gift_wishlist`

```prisma
enum MediaAssetPurpose { memory child_avatar gift }   // ALTER TYPE ... ADD VALUE 'gift'

model Gift {
  id               String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  familyId         String    @map("family_id") @db.Uuid
  childId          String    @map("child_id") @db.Uuid
  title            String
  url              String
  price            String?
  photoMediaId     String    @unique @map("photo_media_id") @db.Uuid
  createdByUserId  String    @map("created_by_user_id") @db.Uuid
  reservedByUserId String?   @map("reserved_by_user_id") @db.Uuid
  reservedAt       DateTime? @map("reserved_at") @db.Timestamptz(3)
  boughtAt         DateTime? @map("bought_at") @db.Timestamptz(3)
  version          Int       @default(1)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  // FK: family (cascade); [childId, familyId] → children; [photoMediaId, familyId] → media_assets (restrict);
  //     [familyId, createdByUserId] и [familyId, reservedByUserId] → family_members
  // CHECK: boughtAt IS NULL OR reservedByUserId IS NOT NULL; reservedAt и reservedByUserId вместе
  @@index([familyId, childId])
  @@map("gifts")
}
```

Обратные relation — в `Family`, `Child`, `MediaAsset`, `FamilyMember`. Значение enum в той же миграции не использовать.

### 5. Стыки с соседними модулями (правятся в backend-таске)

- `families/application/family-service.ts` `removeMember`, транзакция: `tx.gift.updateMany({ where: { familyId, reservedByUserId: userId, boughtAt: null }, data: { reservedByUserId: null, reservedAt: null, version: { increment: 1 } } })` — идемпотентно.
- `media/infrastructure/prisma-media-repository.ts` `resolveContent`: ветка `{ purpose: 'gift', giftPhotoFor: { isNot: null } }` (имя relation — по схеме); тип purpose на строке ~385 расширить.
- `backend/src/jobs.ts` `media:pending:cleanup`: оба фильтра исключают ассеты, привязанные к подарку.
- `media/application/media-service.ts` `reserve`: `gift` идёт по ветке `requireFull` — проверить тестом, логику не менять.

### 6. Webapp — фича `webapp/src/features/gifts`

- **Выставляет через `index.ts`:** `GiftsPage` с props `{ familyId, child: { id, name }, currentUserId, role: 'full' | 'viewer', isOwner, membershipEpoch, transport, hostBridge, onFeed, onFamily, onAdd }`.
- **Внутри:** `api.ts` (`loadGifts`, `createGift`, `updateGift`, `deleteGift`, `reserveGift`, `cancelGiftReservation`, `markGiftBought`, `unmarkGiftBought`, по образцу `features/comments/api.ts`, `timeoutMs: 15_000`), `queries.ts` (ключи `['session', 'gifts', familyId, accountId, membershipEpoch]` — не персистятся), `GiftsPage.tsx`, `GiftCard.tsx`, `GiftForm.tsx` (в `MemolyBottomSheet`), `gifts.css`.
- Фото: загрузка `uploadFamilyPhoto(transport, familyId, file, contentType, 'gift', signal, onStage, idempotencyKey)` из `@/features/family` (сигнатуру расширить на `'gift'`), проверки `verifyComposerFile`/`validateSize`; показ — `usePrivateImageUrl` с путём `/api/v1/families/${familyId}/media/${mediaId}/content?variant=preview`.

### 7. Навигация и оболочка

- `App.tsx`: `screen: 'hub' | 'family' | 'feed' | 'gifts'`, `visitedSurfaces`, `surfaceScroll`, `switchSurface('gifts')`, третья лениво смонтированная поверхность `data-navigation-surface="gifts"`.
- `platform/persistence/private-cache.ts`: тип `PersistentFamilyPresentation.screen` и `validatePresentation` принимают `'gifts'`.
- `BottomNavigation.tsx`: `active: 'feed' | 'family' | 'gifts'`, новый проп `onGifts`, порядок «Лента · Подарки · Добавить/Просмотр · Семья», `grid-cols-4`, `data-nav-position='gifts'`; CSS в `styles/tokens.css` и `components/ui-v2/shared-skin.css`. Проп протянуть во все три места монтирования (`FeedPresentation`, `FamilyScreen`, `FeedShell`) и в `GiftsPage`.
- Иконка `gift`: WebP RGBA, состояния default/active/white × @2x (48 px) / @3x (72 px) в `assets/icons/` и `webapp/public/assets/icons/`, запись в `assets/manifest.json` и `webpIconNames`; стиль — как у `family`/`home`.

### 8. Внешние ссылки — `platform/host-bridge.ts`

- Новый метод `openExternalLink?(url: string): boolean`. Общая проверка `isSafeExternalLink(url)`: `new URL` без исключения, `protocol` `http:` или `https:`, нет `username`/`password`.
- MAX (`platform/max/host-bridge.ts`): `webApp.openLink(url)` после проверки. Существующий `openExternalUrl` и `isOwnHttpsUrl` не менять.
- Браузер (`platform/telegram/host-bridge.ts`, `createBrowserDevHostBridge`): `window.open(url, '_blank', 'noopener,noreferrer')` после проверки.
- Unit-тест на `isSafeExternalLink` и оба моста.

### Швы для тестов

- HTTP-маршруты `/gifts` — интеграционные тесты прав и гонок (full/viewer/owner/чужая семья, двойная бронь, удаление участника).
- `gifts.ts` контракты — unit (url, title, price).
- `isSafeExternalLink` и мосты — unit.
- `private-cache` валидатор с `'gifts'` — unit.

## Что построили завершённые таски
<!-- дописывается оркестратором -->

### Таск 01 — подарки на сервере (готово)
- Контракты `@web-app-demo/contracts`: `MAX_ACTIVE_GIFTS=200`, `isAllowedGiftUrl(url)`, `giftTitleSchema`, `giftUrlSchema` (trim, ≤2048, http/https, без логина-пароля, без пробелов и управляющих символов), `giftPriceSchema`, `giftsParamsSchema`, `giftParamsSchema`, `giftReservationDtoSchema`, `giftDtoSchema`, `giftListResponseSchema`, `createGiftRequestSchema`, `updateGiftRequestSchema`, `giftVersionRequestSchema`, `deleteGiftHeadersSchema`, `giftMutationResponseSchema`; типы `GiftDto`, `GiftReservationDto`, `GiftListResponse`, `CreateGiftRequest`, `UpdateGiftRequest`, `GiftVersionRequest`, `GiftMutationResponse`. `mediaPurposeSchema` принимает `gift`.
- `GiftDto = {id, childId, title, url, price: string|null, photoMediaId, createdBy:{userId,name}, reservation:{userId,name,reservedAt,boughtAt|null}|null, version, createdAt, updatedAt}`. Список `{gifts}`, мутации `{gift}`.
- Маршруты под `/api/v1/families/{familyId}/gifts`: GET → 200; POST + `Idempotency-Key` → 201 (200 повтор); PATCH `/{giftId}` → 200; DELETE `/{giftId}` + `If-Match` → 204 (повтор 404); POST/DELETE `/{giftId}/reservation` и `/{giftId}/purchase` с телом `{expectedVersion}` → 200 `{gift}`.
- Коды: непригодное фото (чужое, не gift, удалённое, занятое) → 422 `INVALID_INPUT`; лимит → 422 «В списке уже 200 подарков — удалите ненужные»; «куплено» без брони → 409 `CONFLICT`, не своя бронь → 403; повтор своей брони, снятие брони свободного, повтор «куплено»/отмены → 200 без изменений.
- Backend: `createGiftsModule({db, familyAccess, idempotencyExecutor, idempotencySecret?, requireAuth, now?}) → {routes}`, `giftPrivacyMiddleware`; relation `MediaAsset.giftPhotoFor`.
