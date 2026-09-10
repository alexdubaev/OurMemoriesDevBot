CREATE TYPE "telegram_inbox_kind" AS ENUM ('command', 'content', 'denied');
CREATE TYPE "telegram_source_kind" AS ENUM ('note', 'photo', 'video', 'voice');
CREATE TYPE "telegram_source_status" AS ENUM ('accepted', 'processing', 'published', 'rejected');
CREATE TYPE "telegram_album_status" AS ENUM ('collecting', 'published', 'mixed', 'rejected');

CREATE TABLE "telegram_inbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "bot_id" BIGINT NOT NULL,
    "update_id" BIGINT NOT NULL,
    "event_kind" "telegram_inbox_kind" NOT NULL,
    "encrypted_payload" BYTEA NOT NULL,
    "encryption_iv" BYTEA NOT NULL,
    "encryption_auth_tag" BYTEA NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    CONSTRAINT "telegram_inbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "inbox_id" UUID NOT NULL,
    "bot_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "sender_subject" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "child_id" UUID NOT NULL,
    "kind" "telegram_source_kind" NOT NULL,
    "media_group_id" TEXT,
    "status" "telegram_source_status" NOT NULL DEFAULT 'accepted',
    "planned_memory_id" UUID NOT NULL,
    "planned_media_id" UUID,
    "memory_id" UUID,
    "media_id" UUID,
    "rejection_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "telegram_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_albums" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "bot_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "media_group_id" TEXT NOT NULL,
    "status" "telegram_album_status" NOT NULL DEFAULT 'collecting',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "ready_at" TIMESTAMPTZ(6) NOT NULL,
    "hard_deadline" TIMESTAMPTZ(6) NOT NULL,
    "memory_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "telegram_albums_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_inbox_bot_update_key" ON "telegram_inbox"("bot_id", "update_id");
CREATE INDEX "telegram_inbox_processing_idx" ON "telegram_inbox"("processed_at", "received_at");
CREATE UNIQUE INDEX "telegram_sources_inbox_id_key" ON "telegram_sources"("inbox_id");
CREATE UNIQUE INDEX "telegram_sources_bot_chat_message_key" ON "telegram_sources"("bot_id", "chat_id", "message_id");
CREATE INDEX "telegram_sources_album_order_idx" ON "telegram_sources"("bot_id", "chat_id", "media_group_id", "message_id");
CREATE INDEX "telegram_sources_status_idx" ON "telegram_sources"("status", "updated_at");
CREATE UNIQUE INDEX "telegram_albums_bot_chat_group_key" ON "telegram_albums"("bot_id", "chat_id", "media_group_id");
CREATE INDEX "telegram_albums_ready_idx" ON "telegram_albums"("status", "ready_at");
ALTER TABLE "telegram_sources" ADD CONSTRAINT "telegram_sources_inbox_id_fkey" FOREIGN KEY ("inbox_id") REFERENCES "telegram_inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
