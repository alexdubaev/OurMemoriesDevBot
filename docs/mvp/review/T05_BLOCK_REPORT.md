# Block 05 handoff — audio, video and captions

Task ID / дата / исполнитель / модель: T05 / 2026-09-10 / Codex / GPT-5

Статус: REVIEW

Worktree / branch / base SHA / implementation head before this handoff: `D:/codex/TG_OurMemoriesDevBot/worktrees/t05-audio-video-captions` / `feat/t05-audio-video-captions` / `5ccc4b3f8ab3f27fb0a734b7f74406f6b792724f` / `d4aa36b530ba6200100c20615dd3f25142c6d089`

PR / merge SHA: не опубликовано / не слито. Последняя попытка `git fetch origin --prune` не достигла `github.com:443`; перед публикацией нужно повторить fetch и сверить base.

## Выполнено

- Внешний provider-neutral FFmpeg/ffprobe boundary: `FFMPEG_PATH` и `FFPROBE_PATH`, иначе `PATH`; capability validation происходит перед worker loop.
- CI и runtime image устанавливают системный пакет FFmpeg; `package.json` и `bun.lock` не менялись.
- Voice готовится в AAC/M4A с 48 реальными waveform peaks; video — H.264/AAC MP4 до 720p. Оригинал остаётся приватным и неизменённым, rendition создаётся через durable outbox.
- FFmpeg subprocess получает deadline/AbortSignal, ограничение output, file-only protocol whitelist и лимит output-файла. Existing rendition сверяется по длине, MIME и SHA-256.
- CaptionRequest хранит scope, optimistic version, TTL 10 минут, consumed/cancelled state и FK-инварианты; ForceReply связывается с конкретным prompt. `/cancel` отменяет один детерминированный текущий request. Viewer не обновляет caption.
- TTL 10 минут — прямое решение владельца для T05; оно выше прежнего текста `04_TELEGRAM.md`, где упомянуты 30 минут.

## Проверено

- `ffmpeg -version`, `ffprobe -version`: успешный запуск локально; build Gyan 9.0.1 с AAC, libx264, MP4 muxing, astats и ametadata.
- `bun run test:backend:unit`: 344 passed, exit 0.
- `bun run test:backend:integration -- src/modules/telegram/capture.integration.test.ts`: 9 passed, exit 0; применены все 13 migrations на isolated PostgreSQL.
- `bun run test:contracts`: 34 passed, exit 0.
- `bun run test:webapp`: 84 passed, exit 0.
- `bun run typecheck`, backend/webapp build, `architecture:check`, `template:check`, `audit`, `git diff --check`: exit 0.
- Реальные media fixtures: OGG/Opus→M4A/AAC и HEVC MOV→H.264/AAC MP4 проходят в `renditions.test.ts`.

## Независимое ревью

Проведено ровно три независимых read-only review на SHA `cbfa9b5`: media/runtime, Telegram captions, security/architecture. Внесены и проверены исправления deadline/AbortSignal, bounded process output, protocol/output limits, rendition hash verification, caption FK integrity, deterministic cancel и safe stale/expired feedback. Новый review намеренно не запускался по решению владельца.

## Не выполнено / риски

Production deployment requirement: backend/media worker must run with explicit CPU, memory and PID/process limits at container/runtime level before production use.

Это P2 deployment requirement, а не реализованная cgroup sandbox: canonical backend deployment/Compose configuration в repository отсутствует, а Dockerfile не является корректным уровнем для CPU/RAM/PID enforcement. Новая deployment architecture в T05 не создавалась.

Local Docker image build не завершён: Docker Desktop загружал базовый `oven/bun:1.4.0` медленнее tool timeout. Dockerfile syntax и backend build прошли; при доступной сети образ нужно собрать в CI/перед deploy.

## Следующий шаг

После восстановления доступа к GitHub: `git fetch origin --prune`, сверить `origin/main`, при необходимости merge `origin/main` в feature branch, повторить affected checks, push/PR, дождаться `verify-required`, затем squash merge по проектному процессу. Следующий блок не запускать без назначения.
