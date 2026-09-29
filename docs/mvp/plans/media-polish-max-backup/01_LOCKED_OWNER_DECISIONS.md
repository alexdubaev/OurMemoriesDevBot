# Locked owner decisions

## MVP
Активные MVP contexts:
- PWA/Web;
- MAX;
- iPhone/MAX real-device acceptance.

Telegram:
- POST-MVP;
- не blocker текущего MVP.

## MAX storage role
MAX уже является резервным/provider-хранилищем медиа MVP.

Это не открытый продуктовый вопрос.

### memoLy → MAX
- фото сохраняются в текущем private storage и должны иметь резервную/provider representation в MAX;
- видео используют текущую MAX storage/delivery infrastructure;
- photo-only album и mixed Memory не должны выпадать из MAX backup path.

### MAX live → memoLy
Existing live ingestion — часть MVP:
- один MAX source post/message = один Memory;
- mixed photo/video сохраняет order;
- duplicate delivery не создаёт duplicate Memory.

Отложено только historical import/sync старой истории.

## One Memory invariant
Один create/source post:
- один Memory;
- один caption;
- один author;
- один occurredAt;
- один like state;
- один seen/unread identity;
- один edit/delete lifecycle.

## Media limits
- 1–10 attachments;
- photo/video;
- exact order.
- canonical MAX video limit: `250_000_000` bytes inclusive.

## Carousel
- photo-only multi-photo и mixed имеют одну carousel-концепцию;
- swipe прямо в Feed;
- одинаковая внешняя media-stage geometry;
- video не раздувает карточку;
- fullscreen/detail по нажатию;
- video no autoplay;
- video pause/stop on slide leave.

## Video readiness
Upload complete и MAX processing — разные состояния.
Processing:
- neutral pending state;
- не красная upload error;
- bounded readiness refresh;
- ready обновляется на месте.

## Upload progress/performance
- реальный progress где доступны bytes;
- для нескольких файлов понятный aggregate;
- после 100% upload → отдельное processing state;
- сначала измерить validation/reserve/upload/finalize/processing/create;
- bounded parallelism разрешён только если сохраняет idempotency, order и partial-failure safety.

## MAX backup publication
- photo-only album → MAX backup/provider representation;
- mixed photo/video → MAX representation в том же logical order;
- один Memory не дробится на product-level posts;
- provider identity/references durable/idempotent.

## Historical sync
HI-0..HI-4 остаются `DEFERRED_POST_MVP`.
