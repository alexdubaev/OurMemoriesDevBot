# Данные, контракты и проверяемые инварианты

Все новые структуры согласовываются в `packages/contracts`; wire-схемы Zod, DTO TypeScript. Перечень ниже нормативный, а имена миграций и точные разделения внутренних файлов выбирает этап реализации. SQL-файлы, применённые на пилоте, не переписывать.

## 1. Таблицы
| Сущность | Обязательные поля и ограничения |
|---|---|
| User | Внутренний UUID; display_name; nullable email вместо фиктивного; timestamps |
| ExternalIdentity | UUID, user_id, provider=`telegram`, subject строка десятичного Telegram ID; unique(provider,subject) |
| AuthSession | Переиспользовать безопасную схему Vibe; revoked_at, expiry; роль семьи не записывать в JWT |
| Family | UUID, owner_user_id, name, timezone IANA, status=active/deleting/deleted, storage_used_bytes, storage_reserved_bytes |
| FamilyMember | family_id, user_id, role=full/viewer, joined_at, revoked_at; unique active user pilot constraint; unique(family_id,user_id) |
| Child | UUID, family_id, display_name, nullable birth_date; API MVP не создаёт второго активного ребёнка |
| FamilyInvite | UUID, family_id, role, token_hash, expires_at, created_by, accepted_by, accepted_at, revoked_at; raw token в БД не хранится |
| Memory | UUID, family_id, child_id, author_id, kind=note/photo/video/voice, body, occurred_at timestamptz, created_at, updated_at, version integer, status=processing/published/failed/deleted, deleted_at |
| MediaAsset | UUID, family_id, uploader_id, source_kind=telegram/upload, media_kind=photo/video/voice, original_key, sha256, byte_size bigint, verified_mime, width/height, duration_ms, original_status=pending/stored/failed, rendition_status=pending/ready/failed, deleted_at |
| MediaVariant | UUID, family_id, media_id, variant=preview/display/playback, object_key, sha256, byte_size, MIME, dimensions; unique(media_id,variant) |
| MemoryMedia | family_id, memory_id, media_id, position; unique(memory_id,position), unique(media_id) в MVP; один объект не делится между семьями |
| Like | family_id, memory_id, user_id, created_at; unique(memory_id,user_id); count только active members |
| TelegramInbox | bot_id, update_id bigint, normalized_payload encrypted at rest, received_at, processed_at, status; unique(bot_id,update_id) |
| TelegramSource | family_id, memory_id, bot_id, chat_id bigint, message_id bigint, nullable media_group_id, file_id/file_unique_id; unique(bot_id,chat_id,message_id) |
| CaptionRequest | opaque id/hash, family_id, memory_id, requester_user_id, bot_id, chat_id, prompt_message_id, expected_version, expires_at, used_at |
| UploadReservation | UUID, family_id, user_id, bytes, media_id, expires_at, finalized_at; quota reservation atomic |
| TaskOutbox | Существующая таблица + typed handlers. В payload по возможности ID, не полный текст |
| PrivacyJob | UUID, family_id, requester_id, kind=export/erase, status, result_key nullable, expires_at, error_code |
| AuditEvent | Actor ID, family ID, action, entity ID, status, timestamp; без контента/URL/токенов |

Это модель ответственности, не требование создавать все таблицы этапом 00. Каждый блок добавляет свои сущности. `family_id` дублируется в связях ради составных FK и строгих проверок. PostgreSQL сохраняет BigInt, JSON API передаёт их строками. Internal UUID никогда не считается разрешением сам по себе.

## 2. Инварианты
I01: участник семьи A не может прочитать, получить файл, изменить или поставить лайк записи семьи B.
I02: viewer не может создать/изменить/удалить запись, даже через бота, stale UI, прямой API или ранее полученный upload-ticket.
I03: никакой published media-memory не ссылается на оригинал, который не подтверждён как stored. Производная может готовиться.
I04: один Telegram source message создаёт не больше одной логической записи; фотоальбом исключение только в сторону объединения нескольких source в одну.
I05: обычный текст без reply/caption-request не присоединяется к предыдущему медиа.
I06: отзыв membership проверяется заново перед публикацией/чтением/выдачей файла и перед завершением фонового импорта.
I07: original и backup не удаляются неотслеживаемым fire-and-forget.
I08: человек может поставить только один свой лайк; роль viewer это позволяет.
I09: `owner_user_id` указывает на активного full-участника той же семьи. Последнего владельца удалить/понизить нельзя.
I10: квота учитывает одновременно зарезервированные и сохранённые оригиналы; две конкурентные загрузки не могут обойти лимит.
I11: edit не меняет автора/created_at/принадлежность семьи; optimistic concurrency возвращает 409 на stale version.
I12: итоговая схема не требует Telegram для появления записи от будущего независимого клиента.

Составные FK для child/family, media/family, memory/family; FK пользователя и членства. Repositories всегда принимают familyId, даже для getById. Отдельно тестировать IDOR на чтение content/HEAD/Range, variants, upload-finalize, invites, likes и export. PostgreSQL RLS можно добавить позже как второй барьер, но не выдавать его отсутствие за наличие: в MVP обязательны application guards + FK + негативные интеграционные тесты.

## 3. Общие типы
```ts
export type FamilyRole = 'full' | 'viewer';
export type MemoryKind = 'note' | 'photo' | 'video' | 'voice';
export type MemoryStatus = 'processing' | 'published' | 'failed' | 'deleted';
export type Principal = { userId: string; sessionId: string };
export type FamilyScope = { principal: Principal; familyId: string };
export type MemoryQuery = {
  childId?: string; kind?: MemoryKind; cursor?: string; limit?: number;
};
export type MemoryDto = {
  id: string; familyId: string; childId: string; author: { id: string; name: string };
  kind: MemoryKind; body: string; occurredAt: string; createdAt: string;
  version: number; status: MemoryStatus;
  attachments: MediaDto[];
  likes: { count: number; likedByMe: boolean };
  capabilities: { edit: boolean; delete: boolean; like: boolean };
};
export type MediaDto = {
  id: string; kind: 'photo' | 'video' | 'voice';
  width: number | null; height: number | null; durationMs: number | null;
  renditionStatus: 'pending' | 'ready' | 'failed';
  previewPath: string | null; displayPath: string | null; playbackPath: string | null;
  originalDownloadPath: string; waveform: number[] | null;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ApiError = {
  error: { code: string; message: string; requestId: string; fieldErrors?: Record<string,string> };
};
```

Path — относительный путь нашего backend, не Telegram URL, не object key и не бессрочная публичная ссылка. `capabilities` служат UI; сервер всё равно заново проверяет право. Истинные runtime validators реализуются в этапе владельца контракта.

## 4. Публичные application-порты
```ts
interface FamilyAccess {
  requireMember(scope: FamilyScope): Promise<{ role: FamilyRole; isOwner: boolean }>;
  requireFull(scope: FamilyScope): Promise<void>;
  requireOwner(scope: FamilyScope): Promise<void>;
}
interface Memories {
  createNote(scope: FamilyScope, input: { childId: string; body: string; occurredAt: string; idempotencyKey: string }): Promise<MemoryDto>;
  createMediaMemory(scope: FamilyScope, input: { childId: string; kind: Exclude<MemoryKind,'note'>; mediaIds: string[]; body: string; occurredAt: string; idempotencyKey: string }): Promise<MemoryDto>;
  updateMemory(scope: FamilyScope, id: string, input: { body: string; occurredAt: string; expectedVersion: number }): Promise<MemoryDto>;
  listMemories(scope: FamilyScope, query: MemoryQuery): Promise<Page<MemoryDto>>;
  setLike(scope: FamilyScope, id: string, liked: boolean): Promise<{ count: number; likedByMe: boolean }>;
  deleteMemory(scope: FamilyScope, id: string, expectedVersion: number): Promise<void>;
}
```

Для worker авторизация выполняется actorUserId + familyId через trusted-job scope, не через поддельный пользовательский JWT. trusted-job не означает bypass membership. Server transport создаёт Principal только после проверки сессии.

## 5. HTTP API v1
| Метод и путь | Смысл / успешный результат |
|---|---|
| POST `/api/v1/auth/telegram` | raw initData + CSRF-safe handshake → сессия, sanitized user; секреты не в JSON |
| POST `/api/v1/auth/refresh` | существующая ротация Vibe, HttpOnly refresh cookie |
| POST `/api/v1/auth/logout` | отзыв своей сессии, 204 |
| GET `/api/v1/me` | user, active family, role, isOwner, limits; 200 |
| POST `/api/v1/families` | только pilot-admitted account без active family; body{name,timezone,child}; 201 |
| GET/PATCH `/api/v1/families/:familyId` | read member / change owner; 200 |
| GET `/api/v1/families/:familyId/members` | member; 200 |
| POST `/api/v1/families/:familyId/invites` | owner, body{role}; одноразовый rawToken в ответе только один раз; 201 |
| POST `/api/v1/invites/preview` | аутентифицированный user, body{token}; без полного списка участников; 200 |
| POST `/api/v1/invites/accept` | atomic consume+membership; body{token}; 200 |
| DELETE `/api/v1/families/:familyId/invites/:id` | owner; 204 |
| PATCH `/api/v1/families/:familyId/members/:userId` | owner, body{role}; 200 |
| DELETE `/api/v1/families/:familyId/members/:userId` | owner removing member или member leaving self, кроме owner; 204 |
| GET `/api/v1/families/:familyId/memories` | kind,cursor,limit≤50,childId; Page<MemoryDto> |
| POST `/api/v1/families/:familyId/memories` | note или финализация logical media-memory; body соответствует application input; 201/идемпотентный 200 |
| GET `/api/v1/families/:familyId/memories/:id` | member, чужой/удалённый ID 404 |
| PATCH `/api/v1/families/:familyId/memories/:id` | full, body+occurredAt+expectedVersion; 200 |
| DELETE `/api/v1/families/:familyId/memories/:id` | full, expectedVersion через If-Match; 204 |
| PUT `/api/v1/families/:familyId/memories/:id/like` | body{liked:boolean}, member; идемпотентный 200 |
| POST `/api/v1/families/:familyId/uploads` | full, body{kind,contentType,byteSize}; reservation+signed PUT ticket; 201 |
| POST `/api/v1/families/:familyId/uploads/:id/finalize` | full, проверка фактического объекта; 200 asset / 202 processing |
| GET/HEAD `/api/v1/families/:familyId/media/:id/content` | auth на каждый запрос; variant=preview/display/playback/original; `Content-Type`, `Content-Length`, `Accept-Ranges: bytes`, single Range и корректный `Content-Range`; 200/206 |
| POST `/api/v1/telegram/webhook` | только Telegram webhook secret, не cookie сессия; durable accept → 200 |

Для списка участников скрывать telegram subject, технические IDs приглашений и неизвестные профили. Лайки не открывают отдельный глобальный список людей. Лимиты запросов настраиваются; реальные семейные данные никогда не попадают в URL query.

## 6. Ошибки и идемпотентность
401 SESSION_REQUIRED; 403 ROLE_FORBIDDEN; 404 NOT_FOUND для недоступного family resource; 409 VERSION_CONFLICT / ALREADY_IN_FAMILY / INVITE_USED; 410 INVITE_EXPIRED; 413 FILE_TOO_LARGE; 415 UNSUPPORTED_MEDIA; 422 INVALID_INPUT / INVALID_FILE; 429 RATE_LIMITED; 503 STORAGE_UNAVAILABLE. Ошибка возвращает безопасное русское сообщение и requestId, не stack trace.

POST создания требует `Idempotency-Key` UUID; scope=userId+familyId+route. Повтор с тем же ключом и другим payload →409. Хранить результат 24 часа; Telegram source uniqueness сохраняется независимо. DELETE повтор по уже удалённой своей записи —204; чужая —404.

## 7. Порядок, индекс и синхронизация
Индекс memory `(family_id,status,occurred_at DESC,id DESC)`, дополнительный `(family_id,kind,occurred_at DESC,id DESC)`. Cursor содержит сортировочную пару, фильтры и snapshot верхней границы, подписан сервером. Cursor другой семьи/фильтра →422. Не использовать offset на изменяющейся ленте.

Загрузка следующей страницы дедуплицирует по id. Обновление по focus и раз в 15 секунд только при видимой ленте; нет фонового постоянного polling. Пользовательская правка разрешённой даты может переместить карточку, что не скрывается: обновить запрос и сохранить разумный scroll anchor.

## 8. Минимальные тестовые примеры чистых политик
Ниже — ожидаемая форма будущих тестов, не утверждение наличия реализации.
```ts
import { test, expect } from 'bun:test';
import { mayEditContent, mayLike } from './family-policy';
test('viewer may like but cannot change content', () => {
  expect(mayEditContent('viewer')).toBe(false);
  expect(mayLike('viewer')).toBe(true);
});
```
`mayEditContent(role: FamilyRole): boolean` и `mayLike(role: FamilyRole): boolean` производятся блоком 01. Эти unit-тесты не заменяют запросы к API с реальной PostgreSQL и подстановкой чужих ID.
