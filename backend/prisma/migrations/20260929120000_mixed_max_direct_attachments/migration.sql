ALTER TABLE "max_video_upload_sessions" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'standalone';
ALTER TABLE "max_outbound_sources" ADD COLUMN "width" INTEGER, ADD COLUMN "height" INTEGER, ADD COLUMN "duration_ms" INTEGER;

DROP INDEX "max_video_references_memory_id_key";
DROP INDEX "max_video_references_memory_id_family_id_key";
CREATE INDEX "max_video_references_memory_id_family_id_idx" ON "max_video_references"("memory_id", "family_id");
CREATE UNIQUE INDEX "max_video_references_memory_position_key" ON "max_video_references"("memory_id", "attachment_position");
