-- Reject a missing publication event after a family's unread boundary is activated.
-- Historical published rows may keep a NULL ordinal through ordinary edits.
ALTER TABLE families ADD COLUMN unread_order_version bigint NOT NULL DEFAULT 0
  CONSTRAINT families_unread_order_version_nonnegative CHECK (unread_order_version >= 0);

CREATE FUNCTION guard_memory_first_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  family_ordinal bigint;
  tracking_active boolean;
  first_publication boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.first_published_ordinal IS DISTINCT FROM NEW.first_published_ordinal
       AND (OLD.first_published_ordinal IS NOT NULL OR OLD.status = 'published') THEN
      RAISE EXCEPTION 'first publication ordinal is immutable' USING ERRCODE = '23514';
    END IF;
    first_publication := OLD.status <> 'published' AND NEW.status = 'published' AND NEW.deleted_at IS NULL;
  ELSE
    first_publication := NEW.status = 'published' AND NEW.deleted_at IS NULL;
  END IF;

  IF NOT first_publication THEN RETURN NEW; END IF;

  SELECT publication_ordinal, unread_tracking_activated_at IS NOT NULL
    INTO family_ordinal, tracking_active
    FROM families WHERE id = NEW.family_id;

  IF tracking_active AND
     (NEW.first_published_ordinal IS NULL OR NEW.first_published_ordinal <> family_ordinal) THEN
    RAISE EXCEPTION 'tracked memory publication requires current family ordinal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memories_first_publication_guard
  BEFORE INSERT OR UPDATE OF status, deleted_at, first_published_ordinal ON memories
  FOR EACH ROW EXECUTE FUNCTION guard_memory_first_publication();
