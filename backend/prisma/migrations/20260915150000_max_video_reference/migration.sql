CREATE TABLE "max_video_references" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "attachment_position" INTEGER NOT NULL,
    "provider_attachment_id" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "max_video_references_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "max_video_references_position_check" CHECK ("attachment_position" >= 0),
    CONSTRAINT "max_video_references_width_check" CHECK ("width" IS NULL OR "width" > 0),
    CONSTRAINT "max_video_references_height_check" CHECK ("height" IS NULL OR "height" > 0),
    CONSTRAINT "max_video_references_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" > 0)
);

CREATE UNIQUE INDEX "max_video_references_source_id_key" ON "max_video_references"("source_id");
CREATE UNIQUE INDEX "max_video_references_memory_id_key" ON "max_video_references"("memory_id");
CREATE INDEX "max_video_references_family_id_idx" ON "max_video_references"("family_id");
CREATE UNIQUE INDEX "max_video_references_source_id_family_id_key" ON "max_video_references"("source_id", "family_id");
CREATE UNIQUE INDEX "max_video_references_memory_id_family_id_key" ON "max_video_references"("memory_id", "family_id");

CREATE UNIQUE INDEX "max_sources_id_family_id_key" ON "max_sources"("id", "family_id");

ALTER TABLE "max_video_references" ADD CONSTRAINT "max_video_references_source_id_family_id_fkey"
    FOREIGN KEY ("source_id", "family_id") REFERENCES "max_sources"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "max_video_references" ADD CONSTRAINT "max_video_references_memory_id_family_id_fkey"
    FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
