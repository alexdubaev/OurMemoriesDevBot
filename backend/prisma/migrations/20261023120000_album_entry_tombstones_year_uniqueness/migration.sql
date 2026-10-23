ALTER TABLE "album_entries" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
CREATE INDEX "album_entries_live_order_idx" ON "album_entries"("family_id", "album_id", "deleted_at", "order_key", "id");
CREATE UNIQUE INDEX "albums_one_live_year_per_child_key" ON "albums"("family_id", "child_id")
  WHERE "kind" = 'year' AND "deleted_at" IS NULL;
