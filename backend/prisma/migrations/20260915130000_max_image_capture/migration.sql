CREATE TYPE "max_source_attachment_kind" AS ENUM ('image', 'file');
CREATE TYPE "max_source_attachment_status" AS ENUM ('planned', 'stored', 'failed');

ALTER TYPE "media_source_kind" ADD VALUE 'max';

CREATE TABLE "max_source_attachments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "provider_kind" "max_source_attachment_kind" NOT NULL,
    "provider_attachment_id" TEXT NOT NULL,
    "planned_media_id" UUID NOT NULL,
    "media_id" UUID,
    "status" "max_source_attachment_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "max_source_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "max_source_attachments_source_position_key" ON "max_source_attachments"("source_id", "position");
CREATE UNIQUE INDEX "max_source_attachments_planned_media_id_key" ON "max_source_attachments"("planned_media_id");
CREATE INDEX "max_source_attachments_source_kind_provider_idx" ON "max_source_attachments"("source_id", "provider_kind", "provider_attachment_id");

ALTER TABLE "max_source_attachments" ADD CONSTRAINT "max_source_attachments_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "max_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
