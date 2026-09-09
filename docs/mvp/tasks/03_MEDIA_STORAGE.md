# Блок 03 — Приватные оригиналы, загрузки и просмотр файлов

**Исполнитель:** Sol. **Ревью:** Sol — отдельное ревью безопасности storage, quota и удаления.
**Зависимости:** 02 приняты и слиты в main. Разрешённая параллельная волна A; читать ../PARALLEL_WORK.md.
**Цель:** Файлы действительно сохраняются в независимом приватном хранилище, а не только числятся в базе.
**Правила работы:** корневой `AGENTS.md`; `../PARALLEL_WORK.md`; для UI также `../ASSET_GUIDE.md`.
**Спецификация:** `../00_START_HERE.md`; дополнительно прочитать: 03_DATA_API.md, 05_STORAGE_SECURITY.md, 06_REUSE.md.
**Стек:** выбранный Vibe — Bun/Hono, PostgreSQL/Prisma, React/Vite, общие Zod-контракты.

## Границы
Этот блок — единица сдачи, но внутри выполнять маленькие шаги и сохранять контрольные результаты. Пакет содержит спецификацию; пути ниже — ожидаемые создаваемые/изменяемые файлы, не утверждение их наличия до начала. Если аналогичный файл уже существует по REPO_MAP, использовать его и указать mapping, не создавать дубль. Все пути относятся к корню проекта.

MVP: только личный бот, Telegram Mini App, четыре формата, full/viewer, семейные лайки. Без AI, групп, платежей и реализации будущих платформ. Новые семейные данные — только synthetic fixtures до приёмки закрытого пилота.

## Файлы
backend/src/modules/media/; backend/src/storage/{port.ts,drivers,storage-contract.ts}; backend/src/outbox/handlers.ts; Prisma MediaAsset/Variant/UploadReservation; contracts/media.ts; samples только synthetic.

## Потребляемые и производимые интерфейсы
Потребляет FamilyAccess и AttachmentAccess. Производит reserveUpload/finalize/streamContent, generic stream write/read storage-port и private relative paths; createMediaMemory проверяет семейные media references.

## Порядок выполнения
1. Расширить existing storage-port потоковыми операциями и end-to-end contract tests, не клонировать отдельный S3 wrapper на каждую функцию.
2. Upload reservation фиксирует bytes под family transaction; reserved+used≤quota. SignedPUT краткоживущий, keyserver-generated, уникальный immutable. Pending upload cleanup и retry безопасны.
3. Finalize заново проверяет права, ownership, размер, magic bytes и decode. Блокировать SVG/HTML/executable, path traversal, fake MIME, decompression bomb/слишком большие пиксели.
4. Создать photo original+display+preview; EXIForientation учесть, location metadata убрать из derivatives. HEIC реальным sample и конкретной decoder сборкой. Если поддержка отсутствует, это блокер спецификации, а не тихое объявление success.
5. Endpoint GET/HEAD content проверяет membership и соответствующую опубликованную связь. SingleRange stream из storage, no full file RAM, правильные200/206/416. Ни bot-token URL, ни public ACL.
6. Durable delete jobs сохраняют keys до успеха; daily orphan reconciliation. Legacy avatar lifecycle не применять к memory media.
7. Разделить original_status и rendition_status. В MVP нет Telegram-only fallback при поломкеS3. Клиент видит failure и возможность повторить.

## Обязательные сценарии проверки
F03.1 один storage contract наlocal иS3. F03.2 two uploads у границыquota → один rejected безovershoot. F03.3 revoke послеticket доfinalize →403 иcleanup. F03.4 чужиеasset/variant/HEAD/Range→404. F03.5 MIME spoof/HTML/SVG/oversized image→415/422. F03.6 stream range возвращает ожидаемыеbytes, не всёvideo. F03.7 rename/imagecrop не портитoriginal hash. F03.8 ошибка удаления→retry, keyнепотерян. F03.9 restart послеobjectwrite доDBcommit→reconcile. F03.10 HEICorientation проверена.

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
bun run test:backend:unit -- src/modules/media/media-policy.test.ts
bun run test:backend:integration -- src/modules/media/media-access.integration.test.ts
bun run test:storage:s3
```

## Что показать владельцу
Загрузить тестовое фото, открыть preview и original от full/viewer; user другой семьи не получаетbytes по скопированному URL.

## Критерий готовности
Подтверждена private выдача, quota, hash и cleanup. На локальной разработке облачные credentials не нужны, S3 live test имеет отдельный профиль.

## Стоп-условия
Не выкладывать реальную семью до encryption/backup настройки. Не делать bucket публичным ради отображения фото.

Невозможность запустить обязательный тест отмечается `BLOCKED` с причиной; не заменять его проверкой синтаксиса. Успех в локальной БД не доказывает готовность production-конфигурации.
