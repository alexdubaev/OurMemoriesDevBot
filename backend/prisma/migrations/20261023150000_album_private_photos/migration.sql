CREATE TABLE "album_photos" (
  "media_id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "album_photos_pkey" PRIMARY KEY ("media_id"),
  CONSTRAINT "album_photos_media_id_family_id_key" UNIQUE ("media_id", "family_id"),
  CONSTRAINT "album_photos_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "album_photos_media_id_family_id_fkey" FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "album_photos_family_created_idx" ON "album_photos"("family_id", "created_at", "media_id");

ALTER TABLE "album_entry_sources" ALTER COLUMN "memory_id" DROP NOT NULL;
ALTER TABLE "album_entry_sources" ADD COLUMN "album_photo_media_id" UUID;
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_album_photo_family_fkey"
  FOREIGN KEY ("album_photo_media_id", "family_id") REFERENCES "album_photos"("media_id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_source_identity_check" CHECK (
  ("memory_id" IS NOT NULL AND "album_photo_media_id" IS NULL) OR
  ("memory_id" IS NULL AND "album_photo_media_id" IS NOT NULL AND "source_kind" = 'private_storage' AND "kind" = 'photo' AND "source_id" = "album_photo_media_id")
);
CREATE UNIQUE INDEX "album_entry_sources_entry_album_photo_key" ON "album_entry_sources"("entry_id", "album_photo_media_id") WHERE "album_photo_media_id" IS NOT NULL;

CREATE FUNCTION "guard_album_photo_registry_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset_row media_assets%ROWTYPE;
BEGIN
  PERFORM 1 FROM families WHERE id = NEW.family_id FOR UPDATE;
  SELECT * INTO asset_row FROM media_assets WHERE id = NEW.media_id AND family_id = NEW.family_id FOR UPDATE;
  IF NOT FOUND OR asset_row.purpose <> 'memory' OR asset_row.media_kind <> 'photo'
     OR asset_row.source_kind <> 'upload' OR asset_row.original_status <> 'stored'
     OR asset_row.rendition_status <> 'ready' OR asset_row.deleted_at IS NOT NULL
     OR asset_row.storage_deleted_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM memory_media WHERE media_id = NEW.media_id AND family_id = NEW.family_id) THEN
    RAISE EXCEPTION 'album photo media is unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "album_photos_validate_insert" BEFORE INSERT ON "album_photos"
  FOR EACH ROW EXECUTE FUNCTION "guard_album_photo_registry_insert"();

CREATE FUNCTION "guard_album_photo_memory_media"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM families WHERE id = NEW.family_id FOR UPDATE;
  PERFORM 1 FROM media_assets WHERE id = NEW.media_id AND family_id = NEW.family_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM album_photos WHERE media_id = NEW.media_id AND family_id = NEW.family_id) THEN
    RAISE EXCEPTION 'album-only photo cannot be published to a Memory' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "memory_media_reject_album_photo" BEFORE INSERT OR UPDATE OF "media_id", "family_id" ON "memory_media"
  FOR EACH ROW EXECUTE FUNCTION "guard_album_photo_memory_media"();

CREATE FUNCTION "protect_registered_album_photo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- UPDATE already owns the media row lock. Do not take the family lock here:
    -- claim/publication use family -> media ordering and could deadlock otherwise.
    IF EXISTS (SELECT 1 FROM album_photos WHERE media_id = OLD.id AND family_id = OLD.family_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "media_assets_protect_album_photos" BEFORE UPDATE OF "deleted_at" ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION "protect_registered_album_photo"();
