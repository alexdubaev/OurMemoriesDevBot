-- CreateTable
CREATE TABLE "telegram_video_navigation_replies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "delivery_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "cleanup_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_video_navigation_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_video_navigation_replies_delivery_id_key" ON "telegram_video_navigation_replies"("delivery_id");

-- CreateIndex
CREATE INDEX "telegram_video_navigation_replies_cleanup_idx" ON "telegram_video_navigation_replies"("cleanup_at", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_video_navigation_replies_chat_message_key" ON "telegram_video_navigation_replies"("chat_id", "message_id");

-- AddForeignKey
ALTER TABLE "telegram_video_navigation_replies" ADD CONSTRAINT "telegram_video_navigation_replies_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "telegram_video_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
