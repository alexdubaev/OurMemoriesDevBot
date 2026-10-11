ALTER TABLE "max_video_references"
  ADD COLUMN "thumbnail_media_id" UUID;

CREATE UNIQUE INDEX "max_video_references_thumbnail_media_id_family_id_key"
  ON "max_video_references"("thumbnail_media_id", "family_id");

ALTER TABLE "max_video_references"
  ADD CONSTRAINT "max_video_references_thumbnail_media_id_family_id_fkey"
  FOREIGN KEY ("thumbnail_media_id", "family_id")
  REFERENCES "media_assets"("id", "family_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
