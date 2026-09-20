CREATE TYPE "max_video_upload_session_state" AS ENUM ('reserved', 'uploaded', 'processing', 'message_sent', 'finalized', 'failed', 'expired');

CREATE TABLE "max_video_upload_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "child_id" UUID NOT NULL,
    "planned_memory_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_fingerprint" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "state" "max_video_upload_session_state" NOT NULL DEFAULT 'reserved',
    "provider_upload_token" TEXT,
    "provider_message_id" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retry_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "max_video_upload_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "max_video_upload_sessions_retry_count_check" CHECK ("retry_count" >= 0),
    CONSTRAINT "max_video_upload_sessions_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "max_video_upload_sessions_author_id_fkey"
      FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "max_video_upload_sessions_child_id_family_id_fkey"
      FOREIGN KEY ("child_id", "family_id") REFERENCES "children"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "max_video_upload_sessions_family_idempotency_key"
  ON "max_video_upload_sessions"("family_id", "idempotency_key");
CREATE UNIQUE INDEX "max_video_upload_sessions_family_fingerprint_key"
  ON "max_video_upload_sessions"("family_id", "idempotency_fingerprint");
CREATE UNIQUE INDEX "max_video_upload_sessions_family_planned_memory_key"
  ON "max_video_upload_sessions"("family_id", "planned_memory_id");
CREATE UNIQUE INDEX "max_video_upload_sessions_id_family_id_key"
  ON "max_video_upload_sessions"("id", "family_id");
CREATE INDEX "max_video_upload_sessions_state_expires_idx"
  ON "max_video_upload_sessions"("state", "expires_at");

CREATE TABLE "max_outbound_sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "upload_session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "recipient_id" BIGINT NOT NULL,
    "message_id" TEXT NOT NULL,
    "provider_attachment_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "max_outbound_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "max_outbound_sources_upload_session_id_family_id_fkey"
      FOREIGN KEY ("upload_session_id", "family_id") REFERENCES "max_video_upload_sessions"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "max_outbound_sources_family_id_fkey"
      FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "max_outbound_sources_upload_session_id_key"
  ON "max_outbound_sources"("upload_session_id");
CREATE UNIQUE INDEX "max_outbound_sources_upload_session_id_family_id_key"
  ON "max_outbound_sources"("upload_session_id", "family_id");
CREATE UNIQUE INDEX "max_outbound_sources_provider_identity_key"
  ON "max_outbound_sources"("family_id", "recipient_id", "message_id", "provider_attachment_id");
CREATE UNIQUE INDEX "max_outbound_sources_id_family_id_key"
  ON "max_outbound_sources"("id", "family_id");
CREATE INDEX "max_outbound_sources_family_message_idx"
  ON "max_outbound_sources"("family_id", "message_id");

ALTER TABLE "max_video_references" ALTER COLUMN "source_id" DROP NOT NULL;
ALTER TABLE "max_video_references" ADD COLUMN "outbound_source_id" UUID;
CREATE UNIQUE INDEX "max_video_references_outbound_source_id_key"
  ON "max_video_references"("outbound_source_id");
CREATE UNIQUE INDEX "max_video_references_outbound_source_id_family_id_key"
  ON "max_video_references"("outbound_source_id", "family_id");
ALTER TABLE "max_video_references"
  ADD CONSTRAINT "max_video_references_outbound_source_id_family_id_fkey"
  FOREIGN KEY ("outbound_source_id", "family_id") REFERENCES "max_outbound_sources"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_video_references"
  ADD CONSTRAINT "max_video_references_source_or_outbound_check"
  CHECK (("source_id" IS NOT NULL) <> ("outbound_source_id" IS NOT NULL));
