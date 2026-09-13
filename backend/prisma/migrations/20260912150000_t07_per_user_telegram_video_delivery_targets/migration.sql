-- A reusable target is scoped to one Telegram-origin video and one product user. It is never
-- exposed to Mini App DTOs; only the bot adapter can use its chat/message identifiers.
CREATE TYPE "telegram_video_target_source" AS ENUM ('original', 'delivered_copy');

CREATE TABLE "telegram_video_delivery_targets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "reference_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "source" "telegram_video_target_source" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_video_delivery_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_video_delivery_targets_reference_id_fkey"
      FOREIGN KEY ("reference_id") REFERENCES "telegram_video_references"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "telegram_video_delivery_targets_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "telegram_video_delivery_targets_reference_user_key"
  ON "telegram_video_delivery_targets"("reference_id", "user_id");
CREATE INDEX "telegram_video_delivery_targets_user_id_idx"
  ON "telegram_video_delivery_targets"("user_id");
CREATE UNIQUE INDEX "telegram_video_delivery_targets_chat_message_key"
  ON "telegram_video_delivery_targets"("chat_id", "message_id");
