-- The pinned recovery application knows neither social tables nor discussion generations.
-- Recognize its exact full-month reset while preserving ordinary edits in the current app.
CREATE FUNCTION protect_album_discussion_on_legacy_month_clear() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'month'
     AND NEW.deleted_at IS NULL
     AND NEW.discussion_generation = OLD.discussion_generation
     AND NEW.version = OLD.version + 1
     AND current_setting('memoly.album_entry_edit', true) IS DISTINCT FROM 'preserve'
     AND NEW.title IS NULL AND NEW.caption IS NULL AND NEW.child_quote IS NULL
     AND NEW.category IS NULL AND NEW.date_value IS NULL AND NEW.date_precision = 'unknown'
     AND NOT EXISTS (
       SELECT 1 FROM album_entry_sources
        WHERE family_id = NEW.family_id AND album_id = NEW.album_id AND entry_id = NEW.id
     )
  THEN
    NEW.discussion_generation := OLD.discussion_generation + 1;
    UPDATE album_entry_comments
       SET body = '', deleted_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
     WHERE family_id = NEW.family_id AND album_id = NEW.album_id AND entry_id = NEW.id AND deleted_at IS NULL;
    DELETE FROM album_entry_reactions
     WHERE family_id = NEW.family_id AND album_id = NEW.album_id AND entry_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER album_entries_legacy_clear_discussion
BEFORE UPDATE OF title, caption, child_quote, category, date_value, date_precision ON album_entries
FOR EACH ROW EXECUTE FUNCTION protect_album_discussion_on_legacy_month_clear();
