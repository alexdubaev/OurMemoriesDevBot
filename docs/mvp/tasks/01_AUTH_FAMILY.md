# Блок 01 — Telegram-вход, семейные права и приглашения

**Исполнитель:** Sol. **Ревью:** Sol — отдельный проход проверки угроз и обхода прав.
**Зависимости:** 00 приняты и слиты в main.
**Цель:** Авторизованный человек может создать пилотную семью или явно принять приглашение; права проверяются сервером.
**Правила работы:** корневой `AGENTS.md`; `../PARALLEL_WORK.md`; для UI также `../ASSET_GUIDE.md`.
**Спецификация:** `../00_START_HERE.md`; дополнительно прочитать: 01_PRODUCT.md §§3–4, 02_ARCHITECTURE.md, 03_DATA_API.md §§1–6, 05_STORAGE_SECURITY.md §§6–7.
**Стек:** выбранный Vibe — Bun/Hono, PostgreSQL/Prisma, React/Vite, общие Zod-контракты.

## Границы
Этот блок — единица сдачи, но внутри выполнять маленькие шаги и сохранять контрольные результаты. Пакет содержит спецификацию; пути ниже — ожидаемые создаваемые/изменяемые файлы, не утверждение их наличия до начала. Если аналогичный файл уже существует по REPO_MAP, использовать его и указать mapping, не создавать дубль. Все пути относятся к корню проекта.

MVP: только личный бот, Telegram Mini App, четыре формата, full/viewer, семейные лайки. Без AI, групп, платежей и реализации будущих платформ. Новые семейные данные — только synthetic fixtures до приёмки закрытого пилота.

## Файлы
backend/src/modules/auth/{application,infrastructure,transport}/; backend/src/modules/families/; backend/prisma/schema.prisma и новая migration; packages/contracts/src/{auth,families}.ts; webapp/src/platform/telegram/; tests рядом с модулями.

## Потребляемые и производимые интерфейсы
Потребляет auth-session mechanism Vibe. Производит FamilyAccess requireMember/requireFull/requireOwner; family/invite API из03_DATA_API; mayEditContent(role), mayLike(role). Principal формируется только сервером.

## Порядок выполнения
1. Ввести ExternalIdentity, nullable email без fake email, Family/Member/Child/Invite и pilot admission. Один user может иметь одну active family в MVP; схему членства не вшивать в users.family_id.
2. Проверять raw initData signature/auth_date/duplicate keys, ограничить replay по05. Создать сессию в том же authority boundary, что и Vibe. Настроить same-origin cookie/CSRF; не писать токены в browser storage.
3. Реализовать create family только для pilot-admitted организатора. Имя ребёнка обязательно, birthDate optional, timezone IANA валиден. Owner всегда active full.
4. FamilyAccess — центральные policies. Read недоступного ресурса404, viewer mutation403; service admin не даёт автоматического доступа к чужой семье.
5. Приглашение opaque192bit, hashed at rest, role server-side, single-use72ч. Preview только после login и без семейных медиа; accept атомарен с membership. Истёкшее, отозванное и использованное различаются безопасными сообщениями.
6. Реализовать revoke/change role/leave с защитой owner. Права вступают в силу на следующем защищённом запросе, а не после выхода пользователя.
7. HostBridge в browser только safe metadata/readiness/insets. Dev fixture auth изолирован и не включается env-флагом в production.

## Обязательные сценарии проверки
F01.1 подделанная подпись / просроченные / будущие / duplicated initData fields → отказ. F01.2 повтор exchange не выдаёт новую сессию чужому клиенту. F01.3 refresh остаётся работоспособен после истечения initData. F01.4 viewer не проходит requireFull. F01.5 два concurrent accept одного токена → один член, другой отказ. F01.6 reuse тем же user идемпотентен. F01.7 нельзя понизить/удалить owner. F01.8 невозможно перескочить в другую family по URL. F01.9 revoked membership блокируется с ещё живой session. F01.10 production dev-login отсутствует.

## Проверочный цикл каждого изменения
- [ ] Найти существующие границы и перечислить затронутые файлы до редактирования.
- [ ] Для каждого сценария выше написать или уточнить тест на ближайшем подходящем уровне.
- [ ] Запустить новый тест до реализации и убедиться, что падение относится к нужному поведению, а не к случайной ошибке окружения.
- [ ] Реализовать минимальное изменение в указанном модуле, не менять контракт без согласования его потребителей.
- [ ] Запустить тот же тест, затем связанные проверки из плана области влияния.
- [ ] Проверить diff и выполнить самостоятельный review. При назначенном Sol review получить отдельный проход без опоры только на отчёт исполнителя.
- [ ] Записать команды, результаты и ограничения в отчёт по `../review/BLOCK_REPORT.md`.
- [ ] Передать владельцу результат и остановиться до следующего блока. Commit — в своей ветке, без автоматического merge/deploy.

## Команды проверки
Новые тестовые файлы с указанными именами создаёт этот блок. Фильтр должен реально находить тесты: ноль найденных тестов не является успехом. Если выбранный Vibe использует другую эквивалентную команду, обновить REPO_MAP/verification-map и привести фактический запуск.
```bash
bun run test:backend:unit -- src/modules/families/family-policy.test.ts
bun run test:backend:integration -- src/modules/families/family-access.integration.test.ts
bun run test:backend:integration -- src/modules/auth/telegram-auth.integration.test.ts
bun run test:contracts
```

## Что показать владельцу
На synthetic users создаются две независимые семьи и viewer-приглашение; userB не получает данныеA. Проверка выполняется API-тестами, красивые экраны позже.

## Критерий готовности
Миграции проходят на чистой и существующей тестовой БД; права, replay и конкурентный invite проверены реальной PostgreSQL.

## Стоп-условия
Не подключать email/SMS/OAuth Apple/VK и не делать публичную регистрацию. Невозможность безопасной сессии в mobile Telegram — блокер.

Невозможность запустить обязательный тест отмечается `BLOCKED` с причиной; не заменять его проверкой синтаксиса. Успех в локальной БД не доказывает готовность production-конфигурации.
