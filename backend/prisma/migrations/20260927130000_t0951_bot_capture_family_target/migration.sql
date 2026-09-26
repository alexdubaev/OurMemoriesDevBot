ALTER TYPE "max_outgoing_response_kind" ADD VALUE 'family_choice';
ALTER TYPE "max_inbox_event_kind" ADD VALUE 'family_choice';
ALTER TYPE "telegram_inbox_kind" ADD VALUE 'family_choice';

ALTER TABLE "max_sources"
  ADD COLUMN "choice_candidates" JSONB,
  ADD COLUMN "choice_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "telegram_sources"
  ALTER COLUMN "family_id" DROP NOT NULL,
  ALTER COLUMN "child_id" DROP NOT NULL,
  ADD COLUMN "choice_candidates" JSONB,
  ADD COLUMN "choice_expires_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "telegram_sources_target_pair_check"
    CHECK (("family_id" IS NULL) = ("child_id" IS NULL));

CREATE FUNCTION keep_bot_source_target() RETURNS trigger AS $$
BEGIN
  IF OLD.family_id IS NOT NULL AND
     (NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.child_id IS DISTINCT FROM OLD.child_id) THEN
    RAISE EXCEPTION 'Bot source target is immutable after selection';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER max_source_target_immutable
  BEFORE UPDATE ON "max_sources" FOR EACH ROW EXECUTE FUNCTION keep_bot_source_target();
CREATE TRIGGER telegram_source_target_immutable
  BEFORE UPDATE ON "telegram_sources" FOR EACH ROW EXECUTE FUNCTION keep_bot_source_target();
