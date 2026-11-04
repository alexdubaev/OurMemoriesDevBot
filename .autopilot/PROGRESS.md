<!-- autopilot:progress -->
# memoLy — Telegram-вход

Текущая сборка: `.autopilot/2026-11-04-memoly-telegram-launch-restore--wip/`.
Canonical FULL на чистом 091d0145 прошёл; независимое review — без блокеров. Это снимок подготовки PR, а не доказательство deployment. Фактический выпуск, точный main SHA и production smoke записываются в этом же PR и защищённом release manifest после merge.

## Договорились — не пересматривать

- R10: автоматически не объединять MAX и Telegram identities; членства и роли не менять административно.
- R11/G01: «Да, обновить только URL меню» на https://app.memoly.ru/. Текст сохранён; webhook отсутствует; сообщения не отправляются.
- Telegram auth-only использует TELEGRAM_AUTH_BOT_TOKEN; TELEGRAM_ENABLED=false сохраняет выключенный message lifecycle.
- Из carried.md: Docker/образы/локальные среды находятся на D; одна задача, одна ветка/PR, один общий выпуск.
- Принятые акварельные альбомы, пять пунктов навигации, AlbumEntry discussions и Owner/Full/Viewer policy сохраняются.
- Recovery/S3/locks и запрет отката БД сохраняются. Legacy recovery pair не меняется.

## Не доделано

- На момент подготовки PR publication/deploy и реальный Telegram-вход после обновления ещё pending; не читать этот снимок как подтверждение их успеха.
- R08/R09: синтетические фото/карусель/MAX-video play/pause/seek/unmuted decode подтверждены. Production media требуют законного действующего семейного доступа; не создавать fixture пользователей/семьи или членства на production.
- Реальный iPhone и слышимый звук не подтверждаются Chromium/WebKit/Desktop. Ручная приёмка предыдущей album задачи тоже не объявляется выполненной этим запуском.

## Известные баги

- Test-only fixture server при bind failure может оставить синтетические строки/storage; независимое ревью признало report-only, production не затронут.
- CUA getApp auto-output включил временный signed native URL. Bot token не раскрыт; payload больше не сохранять/не выводить; включение production auth защищено ожиданием полного истечения пяти минут. Дальнейшее чтение AX только emit:false с редактированием адресной строки до вывода.

## Правки без автопилота

—
