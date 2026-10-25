-- Allow an inbound MAX source message to retain one provider reference per video position.
-- Keep the source/family foreign key and every outbound and memory uniqueness guard intact.
CREATE UNIQUE INDEX "max_video_references_source_position_key"
  ON "max_video_references"("source_id", "attachment_position");

DROP INDEX "max_video_references_source_id_key";
DROP INDEX "max_video_references_source_id_family_id_key";
