# Статус проверки пакета (shadcn, 22.10.2026)

Это **документы и визуальный контракт**, не готовое приложение. Production backend, frontend, owner login и collectors этим PR не установлены. Реальные семейные данные не читались/не редактировались.

Проверены предыдущим исследованием: Prisma schema User/Family/Member/MediaAsset/MaxChannelBinding, существующий /api/admin, MAX browser-link, storage port, health, Vite/Caddy/Selectel. Актуальный GitHub main на момент редакции — `48e0d9e8c307a6958a19f6139133ba7026b63f14`, но runtime отдельно не опрашивался.

Исправленный исходный shadcn HTML передан владельцу отдельно. Предыдущий пакет его локального prototyping содержал 6 экранов, мобильную навигацию, темы, таблицы и тестирование fallback/no JS в Chromium; это **не** проверка настоящего MAX/iPhone или production.

В этом окружении не выполнялись repo FULL/build/DB-интеграционные тесты и независимое review этого docs diff. Перед merge применить AGENTS.md; перед последующей реализацией заново проверить runtime и актуальные зависимости. Никогда не заявлять PASS без конкретных exit codes и evidence.

Визуальный первичный зелёный demo в Git-истории устарел и запрещён как эталон. См. `DESIGN_SHADCN.md`.
