# memoLy — Media Polish + MAX Backup Spec Pack
Актуализировано: 2026-09-29

## Цель
После production rollout Mixed Media ручная проверка владельца на iPhone/MAX выявила незакрытые моменты:
- photo-only альбом не свайпается прямо в Feed, а mixed Memory свайпается;
- видео меняет высоту карусели, после возврата к фото остаётся увеличенная рамка/пустота;
- видео визуально вложено в лишние рамки;
- во время provider processing кратковременно показывается failure-like state;
- upload показывает неопределённый spinner без процентов;
- multi-file upload субъективно медленный;
- photo-only album, созданный в memoLy, не резервируется в MAX как должен;
- existing live MAX → memoLy ingestion должен сохраняться.

## Что должно получиться
- photo-only и mixed используют единый Feed carousel;
- стабильная media-stage geometry;
- fullscreen/detail только по нажатию;
- processing video ≠ upload failure;
- upload progress в процентах;
- upload pipeline измерен и оптимизирован безопасно;
- MAX остаётся резервным/provider-хранилищем медиа;
- один memoLy Memory имеет одну логическую MAX representation;
- live MAX multi-attachment post остаётся одним Memory.

## Вне scope
- Telegram — post-MVP;
- historical MAX import HI-0..HI-4 — post-MVP;
- Stories / «В этот день»;
- global redesign;
- profiles;
- immutable CI-built deployment;
- новый storage/media subsystem без blocker.

## Текущая production база
Последний подтверждённый production SHA:
`0bc63edbafc13353a36a5d588350b91fdf20a133`

На момент пакета:
- 39 migrations applied;
- 0 pending;
- frontend/backend/worker/scheduler healthy;
- MAX spike writer stopped;
- Telegram не входит в MVP acceptance.

Перед каждой задачей fresh origin/main authoritative.
