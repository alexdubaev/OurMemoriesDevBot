CREATE TYPE "max_memory_backup_state" AS ENUM ('pending', 'needs_configuration', 'uploading', 'send_intent', 'sent', 'ambiguous', 'failed');
CREATE TYPE "max_memory_backup_attachment_kind" AS ENUM ('image', 'video');

ALTER TABLE "families" ADD COLUMN "max_backup_chat_id" BIGINT;
ALTER TABLE "families" ADD CONSTRAINT "families_max_backup_chat_id_positive" CHECK ("max_backup_chat_id" IS NULL OR "max_backup_chat_id" > 0);
CREATE UNIQUE INDEX "families_max_backup_chat_id_key" ON "families"("max_backup_chat_id");

CREATE TABLE "max_memory_backups" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "state" "max_memory_backup_state" NOT NULL DEFAULT 'needs_configuration',
    "channel_chat_id" BIGINT,
    "provider_message_id" TEXT,
    "send_intent_at" TIMESTAMPTZ(6),
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "max_memory_backups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "max_memory_backups_provider_message_requires_channel" CHECK ("provider_message_id" IS NULL OR "channel_chat_id" IS NOT NULL),
    CONSTRAINT "max_memory_backups_sent_requires_message" CHECK ("state" <> 'sent' OR "provider_message_id" IS NOT NULL),
    CONSTRAINT "max_memory_backups_intent_requires_timestamp" CHECK ("state" NOT IN ('send_intent', 'ambiguous') OR "send_intent_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "max_memory_backups_memory_id_key" ON "max_memory_backups"("memory_id");
CREATE UNIQUE INDEX "max_memory_backups_id_family_id_key" ON "max_memory_backups"("id", "family_id");
CREATE UNIQUE INDEX "max_memory_backups_memory_id_family_id_key" ON "max_memory_backups"("memory_id", "family_id");
CREATE UNIQUE INDEX "max_memory_backups_channel_message_key" ON "max_memory_backups"("channel_chat_id", "provider_message_id");
CREATE INDEX "max_memory_backups_family_state_idx" ON "max_memory_backups"("family_id", "state");

ALTER TABLE "max_memory_backups" ADD CONSTRAINT "max_memory_backups_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_memory_backups" ADD CONSTRAINT "max_memory_backups_memory_id_family_id_fkey"
    FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "max_memory_backup_attachments" (
    "backup_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "max_memory_backup_attachment_kind" NOT NULL,
    "media_id" UUID,
    "upload_session_id" UUID,
    "upload_token" TEXT,

    CONSTRAINT "max_memory_backup_attachments_pkey" PRIMARY KEY ("backup_id", "position"),
    CONSTRAINT "max_memory_backup_attachments_position_check" CHECK ("position" BETWEEN 0 AND 9),
    CONSTRAINT "max_memory_backup_attachments_source_check" CHECK (
        ("media_id" IS NOT NULL AND "upload_session_id" IS NULL) OR
        ("kind" = 'video' AND "media_id" IS NULL AND "upload_session_id" IS NOT NULL)
    )
);

CREATE INDEX "max_memory_backup_attachments_family_media_idx" ON "max_memory_backup_attachments"("family_id", "media_id");
CREATE INDEX "max_memory_backup_attachments_family_session_idx" ON "max_memory_backup_attachments"("family_id", "upload_session_id");
ALTER TABLE "max_memory_backup_attachments" ADD CONSTRAINT "max_memory_backup_attachments_backup_id_family_id_fkey"
    FOREIGN KEY ("backup_id", "family_id") REFERENCES "max_memory_backups"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_memory_backup_attachments" ADD CONSTRAINT "max_memory_backup_attachments_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_memory_backup_attachments" ADD CONSTRAINT "max_memory_backup_attachments_media_id_family_id_fkey"
    FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "max_memory_backup_attachments" ADD CONSTRAINT "max_memory_backup_attachments_upload_session_id_family_id_fkey"
    FOREIGN KEY ("upload_session_id", "family_id") REFERENCES "max_video_upload_sessions"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;
