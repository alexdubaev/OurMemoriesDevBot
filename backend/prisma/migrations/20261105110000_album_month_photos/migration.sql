ALTER TABLE album_entries
  ADD COLUMN month_cover_source_id UUID,
  ADD COLUMN next_photo_position INTEGER,
  ADD CONSTRAINT album_entries_next_photo_position_check
    CHECK (next_photo_position IS NULL OR next_photo_position >= 0),
  ADD CONSTRAINT album_entries_month_cover_source_id_fkey
    FOREIGN KEY (month_cover_source_id) REFERENCES album_entry_sources(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX album_entries_month_cover_source_id_key ON album_entries(month_cover_source_id);
ALTER TABLE album_source_operations
  ADD COLUMN start_position INTEGER,
  ADD COLUMN count INTEGER;
CREATE INDEX album_entry_sources_month_page_idx
  ON album_entry_sources(entry_id, kind, position, id);

CREATE FUNCTION reject_legacy_month_source_replace_after_append() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation = 'set_sources'
     AND EXISTS (
       SELECT 1
         FROM album_entries e
         JOIN albums a ON a.id=e.album_id AND a.family_id=e.family_id
        WHERE e.id=NEW.entry_id
          AND e.album_id=NEW.album_id
          AND e.family_id=NEW.family_id
          AND e.kind='month'
          AND e.deleted_at IS NULL
          AND a.kind='year'
          AND e.next_photo_position IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'This month uses paged photo updates. Update the application before replacing its full source list.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER album_source_operations_legacy_month_replace_fence
BEFORE INSERT ON album_source_operations
FOR EACH ROW EXECUTE FUNCTION reject_legacy_month_source_replace_after_append();
