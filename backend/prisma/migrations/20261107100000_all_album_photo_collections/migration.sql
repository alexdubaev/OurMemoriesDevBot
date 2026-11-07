CREATE OR REPLACE FUNCTION reject_legacy_month_source_replace_after_append() RETURNS trigger
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
          AND e.deleted_at IS NULL
          AND e.next_photo_position IS NOT NULL
     )
  THEN
    RAISE EXCEPTION 'This collection uses paged source updates. Update the application before replacing its full source list.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
