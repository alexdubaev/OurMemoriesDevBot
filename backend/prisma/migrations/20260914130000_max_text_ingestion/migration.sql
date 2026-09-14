CREATE TYPE "max_inbox_event_kind" AS ENUM ('message_created', 'bot_started');
CREATE TYPE "max_inbox_status" AS ENUM ('accepted', 'processed');
CREATE TYPE "max_source_status" AS ENUM ('accepted', 'published', 'denied', 'unsupported_media');
CREATE TYPE "max_outgoing_response_kind" AS ENUM ('accepted', 'saved', 'denied', 'unsupported_media', 'welcome');

CREATE TABLE "max_inbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_key" TEXT NOT NULL,
    "bot_id" BIGINT NOT NULL,
    "event_kind" "max_inbox_event_kind" NOT NULL,
    "encrypted_payload" BYTEA NOT NULL,
    "encryption_iv" BYTEA NOT NULL,
    "encryption_auth_tag" BYTEA NOT NULL,
    "status" "max_inbox_status" NOT NULL DEFAULT 'accepted',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    CONSTRAINT "max_inbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "max_sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "inbox_id" UUID NOT NULL,
    "bot_id" BIGINT NOT NULL,
    "sender_subject" TEXT NOT NULL,
    "recipient_id" BIGINT NOT NULL,
    "message_id" TEXT NOT NULL,
    "status" "max_source_status" NOT NULL DEFAULT 'accepted',
    "planned_memory_id" UUID NOT NULL,
    "memory_id" UUID,
    "user_id" UUID,
    "family_id" UUID,
    "child_id" UUID,
    "rejection_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "max_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "max_outgoing_responses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "inbox_id" UUID NOT NULL,
    "destination_user_id" BIGINT NOT NULL,
    "kind" "max_outgoing_response_kind" NOT NULL,
    "text" TEXT NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "max_outgoing_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "max_inbox_event_key_key" ON "max_inbox"("event_key");
CREATE INDEX "max_inbox_processing_idx" ON "max_inbox"("status", "received_at");
CREATE UNIQUE INDEX "max_sources_inbox_id_key" ON "max_sources"("inbox_id");
CREATE UNIQUE INDEX "max_sources_bot_recipient_message_key" ON "max_sources"("bot_id", "recipient_id", "message_id");
CREATE INDEX "max_sources_status_idx" ON "max_sources"("status", "updated_at");
CREATE UNIQUE INDEX "max_outgoing_responses_inbox_kind_key" ON "max_outgoing_responses"("inbox_id", "kind");
CREATE INDEX "max_outgoing_responses_pending_delivery_idx" ON "max_outgoing_responses"("delivered_at", "created_at");

ALTER TABLE "max_sources" ADD CONSTRAINT "max_sources_inbox_id_fkey"
    FOREIGN KEY ("inbox_id") REFERENCES "max_inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_outgoing_responses" ADD CONSTRAINT "max_outgoing_responses_inbox_id_fkey"
    FOREIGN KEY ("inbox_id") REFERENCES "max_inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
