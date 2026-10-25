CREATE TABLE "max_video_legacy_retention" (
  "media_id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "reference_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "provider_attachment_id" TEXT NOT NULL,
  "provider_recipient_id" BIGINT NOT NULL,
  "provider_channel_id" BIGINT,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recovered_at" TIMESTAMPTZ(6),
  CONSTRAINT "max_video_legacy_retention_pkey" PRIMARY KEY ("media_id"),
  CONSTRAINT "max_video_legacy_retention_media_id_family_id_fkey"
    FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "max_video_legacy_retention_reference_id_key" ON "max_video_legacy_retention"("reference_id");
CREATE UNIQUE INDEX "max_video_legacy_retention_memory_position_key" ON "max_video_legacy_retention"("memory_id", "position");
CREATE UNIQUE INDEX "max_video_legacy_retention_media_family_key" ON "max_video_legacy_retention"("media_id", "family_id");
CREATE INDEX "max_video_legacy_retention_family_recovered_idx" ON "max_video_legacy_retention"("family_id", "recovered_at");

ALTER TABLE "media_assets" ADD COLUMN "legacy_video_retained_at" TIMESTAMPTZ(6);
UPDATE "media_assets" SET "legacy_video_retained_at" = CURRENT_TIMESTAMP
 WHERE "media_kind" = 'video' AND "storage_deleted_at" IS NULL;

CREATE FUNCTION "hold_inserted_legacy_max_video"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_kind = 'max' AND NEW.media_kind = 'video' THEN
    NEW.legacy_video_retained_at := COALESCE(NEW.legacy_video_retained_at, CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "media_assets_hold_inserted_legacy_max_video"
  BEFORE INSERT ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION "hold_inserted_legacy_max_video"();

CREATE FUNCTION "protect_retained_max_video_asset"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.legacy_video_retained_at IS NOT NULL OR EXISTS (SELECT 1 FROM max_video_legacy_retention WHERE media_id = OLD.id AND family_id = OLD.family_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    IF (OLD.legacy_video_retained_at IS NOT NULL AND NEW.legacy_video_retained_at IS NULL)
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
       OR (OLD.storage_deleted_at IS NULL AND NEW.storage_deleted_at IS NOT NULL) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER "media_assets_protect_retained_max_video"
  BEFORE UPDATE OF "legacy_video_retained_at", "deleted_at", "storage_deleted_at" OR DELETE ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION "protect_retained_max_video_asset"();
