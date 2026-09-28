ALTER TYPE memory_kind ADD VALUE 'media';

ALTER TABLE memories
  ADD COLUMN first_published_at timestamptz(6),
  ADD COLUMN source_published_at timestamptz(6);

CREATE OR REPLACE FUNCTION guard_memory_first_publication() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD.first_published_at IS NOT NULL AND OLD.first_published_at IS DISTINCT FROM NEW.first_published_at THEN
      RAISE EXCEPTION 'first publication timestamp is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.source_published_at IS NOT NULL AND OLD.source_published_at IS DISTINCT FROM NEW.source_published_at THEN
      RAISE EXCEPTION 'source publication timestamp is immutable' USING ERRCODE = '23514';
    END IF;
    first_publication := OLD.status <> 'published' AND NEW.status = 'published' AND NEW.deleted_at IS NULL;
    IF NEW.first_published_at IS NOT NULL AND OLD.first_published_at IS NULL AND NOT first_publication THEN
      RAISE EXCEPTION 'first publication timestamp can only be set on publication' USING ERRCODE = '23514';
    END IF;
  ELSE
    first_publication := NEW.status = 'published' AND NEW.deleted_at IS NULL;
  END IF;

  IF NOT first_publication THEN RETURN NEW; END IF;
  IF NEW.first_published_at IS NULL THEN
    RAISE EXCEPTION 'new memory publication requires first publication timestamp' USING ERRCODE = '23514';
  END IF;

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

DROP TRIGGER memories_first_publication_guard ON memories;
CREATE TRIGGER memories_first_publication_guard
  BEFORE INSERT OR UPDATE OF status, deleted_at, first_published_ordinal, first_published_at, source_published_at ON memories
  FOR EACH ROW EXECUTE FUNCTION guard_memory_first_publication();