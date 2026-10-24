CREATE FUNCTION "protect_registered_gift_photo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- UPDATE already owns the media row lock. Do not take the family lock here:
    -- gift creation/edit and media cleanup use family -> media ordering.
    IF EXISTS (
      SELECT 1 FROM gifts
      WHERE photo_media_id = OLD.id AND family_id = OLD.family_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "media_assets_protect_gift_photos" BEFORE UPDATE OF "deleted_at" ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION "protect_registered_gift_photo"();
