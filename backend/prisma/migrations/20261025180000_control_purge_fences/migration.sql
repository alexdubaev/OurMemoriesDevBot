ALTER TABLE "control_user_deletions" ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6);
ALTER TABLE "control_family_deletions" ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6);
CREATE INDEX "control_user_deletions_attempt_idx" ON "control_user_deletions"("last_attempt_at", "purge_after", "id") WHERE "purged_at" IS NULL;
CREATE INDEX "control_family_deletions_attempt_idx" ON "control_family_deletions"("last_attempt_at", "requested_at", "id") WHERE "purged_at" IS NULL;

-- Business rows cannot be inserted into, or reparented across, a family while it is inactive.
-- The row lock serializes content creation with lifecycle's Family FOR UPDATE boundary.
CREATE FUNCTION "control_require_active_content_family"() RETURNS trigger AS $$
DECLARE
  family_ids UUID[];
  operation_id UUID;
  locked_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."family_id" IS NOT DISTINCT FROM OLD."family_id" THEN
    RETURN NEW;
  END IF;
  BEGIN
    operation_id := NULLIF(current_setting('app.control_content_purge_operation', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    operation_id := NULL;
  END;
  IF TG_OP = 'UPDATE' AND operation_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "control_family_deletions" deletion JOIN "families" family ON family.id = deletion.family_id
     WHERE deletion.id = operation_id AND deletion.family_id = OLD."family_id"
       AND deletion.keys_captured_at IS NOT NULL AND family.status <> 'active'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."family_id" IS NULL THEN RETURN NEW; END IF;
    family_ids := ARRAY[NEW."family_id"];
  ELSE
    family_ids := ARRAY_REMOVE(ARRAY[OLD."family_id", NEW."family_id"], NULL);
  END IF;
  SELECT COUNT(*) INTO locked_count
    FROM (SELECT id, status FROM "families" WHERE id = ANY(family_ids) ORDER BY id FOR SHARE) locked
   WHERE locked.status = 'active';
  IF locked_count <> cardinality(family_ids) THEN
    RAISE EXCEPTION 'family content requires active family'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'children', 'memories', 'media_assets', 'upload_reservations', 'gifts', 'albums',
    'album_entries', 'album_entry_sources', 'album_photos', 'album_source_operations',
    'memory_child_tags', 'memory_comments', 'memory_seen', 'memory_likes', 'memory_media',
    'caption_requests', 'family_invites', 'max_video_upload_sessions', 'max_outbound_sources',
    'max_memory_backups', 'max_memory_backup_attachments', 'max_channel_bindings',
    'max_sources', 'max_video_references', 'max_video_legacy_retention',
    'telegram_sources', 'telegram_video_references', 'telegram_video_deliveries'
  ] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "control_require_active_content_family"()',
      table_name || '_control_active_family', table_name);
  END LOOP;
END $$;

CREATE FUNCTION "control_require_active_media_key"() RETURNS trigger AS $$
DECLARE family_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."family_id" IS NOT DISTINCT FROM OLD."family_id"
      AND NEW."original_key" IS NOT DISTINCT FROM OLD."original_key" THEN
    RETURN NEW;
  END IF;
  family_id := NEW."family_id";
  PERFORM 1 FROM "families" WHERE id = family_id AND status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media key requires active family'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE id = NEW."uploader_id" AND control_state = 'active') THEN
    RAISE EXCEPTION 'media key requires active uploader'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "media_assets_control_active_key"
  BEFORE INSERT OR UPDATE ON "media_assets"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_media_key"();

CREATE FUNCTION "control_require_active_variant_key"() RETURNS trigger AS $$
DECLARE family_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."object_key" IS NOT DISTINCT FROM OLD."object_key"
      AND NEW."media_id" IS NOT DISTINCT FROM OLD."media_id"
      AND NEW."family_id" IS NOT DISTINCT FROM OLD."family_id" THEN
    RETURN NEW;
  END IF;
  SELECT asset."family_id" INTO family_id
    FROM "media_assets" asset JOIN "families" family ON family.id = asset.family_id
   WHERE asset.id = NEW."media_id" AND asset.family_id = NEW."family_id" AND family.status = 'active'
   FOR SHARE OF family;
  IF family_id IS NULL THEN
    RAISE EXCEPTION 'media variant requires active family'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "media_variants_control_active_key"
  BEFORE INSERT OR UPDATE ON "media_variants"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_variant_key"();

CREATE FUNCTION "control_require_active_telegram_target"() RETURNS trigger AS $$
DECLARE family_status "family_status";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."reference_id" IS NOT DISTINCT FROM OLD."reference_id" THEN
    RETURN NEW;
  END IF;
  SELECT family.status INTO family_status
    FROM "telegram_video_references" reference JOIN "families" family ON family.id = reference.family_id
   WHERE reference.id = NEW."reference_id" FOR SHARE OF family;
  IF family_status IS DISTINCT FROM 'active'::"family_status" THEN
    RAISE EXCEPTION 'telegram target requires active family'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "telegram_video_delivery_targets_control_active_family"
  BEFORE INSERT OR UPDATE ON "telegram_video_delivery_targets"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_telegram_target"();

CREATE FUNCTION "control_require_active_avatar_key"() RETURNS trigger AS $$
DECLARE user_state "control_user_state";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."user_id" IS NOT DISTINCT FROM OLD."user_id"
      AND NEW."object_key" IS NOT DISTINCT FROM OLD."object_key" THEN
    RETURN NEW;
  END IF;
  SELECT "control_state" INTO user_state FROM "users" WHERE id = NEW."user_id" FOR NO KEY UPDATE;
  IF user_state IS DISTINCT FROM 'active'::"control_user_state" THEN
    RAISE EXCEPTION 'avatar key requires active user'
      USING ERRCODE = '23514', CONSTRAINT = 'control_avatar_active_user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "user_avatars_control_active_key"
  BEFORE INSERT OR UPDATE ON "user_avatars"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_avatar_key"();

CREATE FUNCTION "control_require_active_upload_user"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."user_id" IS NOT DISTINCT FROM OLD."user_id" THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "users" WHERE id = NEW."user_id" AND control_state = 'active') THEN
    RAISE EXCEPTION 'upload reservation requires active user'
      USING ERRCODE = '23514', CONSTRAINT = 'control_upload_active_user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "upload_reservations_control_active_user"
  BEFORE INSERT OR UPDATE ON "upload_reservations"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_upload_user"();

CREATE FUNCTION "control_require_active_channel_candidates"() RETURNS trigger AS $$
DECLARE family_ids UUID[];
DECLARE active_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."selected_family_id" IS NOT DISTINCT FROM OLD."selected_family_id"
      AND NEW."candidate_family_ids" IS NOT DISTINCT FROM OLD."candidate_family_ids" THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(array_agg(candidate::uuid), ARRAY[]::uuid[]) INTO family_ids
    FROM jsonb_array_elements_text(COALESCE(NEW."candidate_family_ids"::jsonb, '[]'::jsonb)) candidate;
  IF NEW."selected_family_id" IS NOT NULL THEN family_ids := array_append(family_ids, NEW."selected_family_id"); END IF;
  IF cardinality(family_ids) = 0 THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO active_count FROM (
    SELECT id, status FROM families WHERE id = ANY(family_ids) ORDER BY id FOR SHARE
  ) locked WHERE status = 'active';
  IF active_count <> (SELECT COUNT(DISTINCT id) FROM unnest(family_ids) AS id) THEN
    RAISE EXCEPTION 'channel selection requires active families'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "max_channel_decisions_control_active_candidates"
  BEFORE INSERT OR UPDATE ON "max_channel_decisions"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_channel_candidates"();

-- Old runtimes cannot turn a redacted processed inbox event back into content or a response.
CREATE FUNCTION "control_reject_redacted_source_replay"() RETURNS trigger AS $$
DECLARE payload_length INTEGER;
DECLARE processed_at TIMESTAMPTZ(6);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."rejection_code" = 'control_archive_purged' THEN
    RAISE EXCEPTION 'redacted provider source is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_source_replay';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT octet_length("encrypted_payload"), "processed_at" INTO payload_length, processed_at
    FROM "telegram_inbox" WHERE id = NEW."inbox_id";
  IF payload_length = 0 OR processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'redacted provider event cannot recreate content'
      USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_source_replay';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "telegram_sources_control_no_redacted_replay"
  BEFORE INSERT OR UPDATE ON "telegram_sources" FOR EACH ROW EXECUTE FUNCTION "control_reject_redacted_source_replay"();

CREATE FUNCTION "control_reject_redacted_max_replay"() RETURNS trigger AS $$
DECLARE payload_length INTEGER;
DECLARE inbox_status "max_inbox_status";
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."rejection_code" = 'control_archive_purged' THEN
    RAISE EXCEPTION 'redacted provider source is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_source_replay';
  END IF;
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT octet_length("encrypted_payload"), "status" INTO payload_length, inbox_status
    FROM "max_inbox" WHERE id = NEW."inbox_id";
  IF payload_length = 0 OR inbox_status = 'processed' THEN
    RAISE EXCEPTION 'redacted provider event cannot recreate content'
      USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_source_replay';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "max_sources_control_no_redacted_replay"
  BEFORE INSERT OR UPDATE ON "max_sources" FOR EACH ROW EXECUTE FUNCTION "control_reject_redacted_max_replay"();

CREATE FUNCTION "control_require_active_max_source_attachment"() RETURNS trigger AS $$
DECLARE source_family_id UUID;
DECLARE family_status "family_status";
DECLARE source_redacted BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."source_id" IS NOT DISTINCT FROM OLD."source_id" THEN RETURN NEW; END IF;
  SELECT source.family_id, source.rejection_code = 'control_archive_purged'
    INTO source_family_id, source_redacted FROM "max_sources" source WHERE source.id = NEW."source_id";
  IF source_family_id IS NULL THEN
    IF source_redacted THEN
      RAISE EXCEPTION 'redacted provider source cannot receive attachments'
        USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_source_replay';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO family_status FROM "families" WHERE id = source_family_id FOR SHARE;
  IF family_status IS DISTINCT FROM 'active'::"family_status" THEN
    RAISE EXCEPTION 'provider attachment requires active family'
      USING ERRCODE = '23514', CONSTRAINT = 'control_content_active_family';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "max_source_attachments_control_active_family"
  BEFORE INSERT OR UPDATE ON "max_source_attachments"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_max_source_attachment"();

CREATE FUNCTION "control_reject_response_for_redacted_inbox"() RETURNS trigger AS $$
DECLARE payload_length INTEGER;
DECLARE inbox_status "max_inbox_status";
BEGIN
  SELECT octet_length("encrypted_payload"), "status" INTO payload_length, inbox_status
    FROM "max_inbox" WHERE id = NEW."inbox_id";
  IF payload_length = 0 OR inbox_status = 'processed' THEN
    RAISE EXCEPTION 'redacted provider event cannot create a response'
      USING ERRCODE = '23514', CONSTRAINT = 'control_redacted_response';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "max_outgoing_responses_control_no_redacted_replay"
  BEFORE INSERT ON "max_outgoing_responses" FOR EACH ROW EXECUTE FUNCTION "control_reject_response_for_redacted_inbox"();
