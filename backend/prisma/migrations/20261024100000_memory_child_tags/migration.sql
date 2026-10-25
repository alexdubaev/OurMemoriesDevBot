-- Expand-only: several children per memory. Memory.child_id stays mandatory as the legacy anchor,
-- so the previous runtime keeps working against this schema.
ALTER TABLE "children" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "memories" ADD COLUMN "child_tags_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "memory_child_tags" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "family_id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "child_id" UUID NOT NULL,
  "attachment_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_child_tags_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_child_tags_memory_id_family_id_fkey" FOREIGN KEY ("memory_id", "family_id")
    REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memory_child_tags_child_id_family_id_fkey" FOREIGN KEY ("child_id", "family_id")
    REFERENCES "children"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "memory_child_tags_publication_key" ON "memory_child_tags"("memory_id", "child_id")
  WHERE "attachment_id" IS NULL;
CREATE UNIQUE INDEX "memory_child_tags_attachment_key" ON "memory_child_tags"("memory_id", "attachment_id", "child_id")
  WHERE "attachment_id" IS NOT NULL;
CREATE INDEX "memory_child_tags_family_child_memory_idx" ON "memory_child_tags"("family_id", "child_id", "memory_id");
CREATE INDEX "memory_child_tags_family_memory_idx" ON "memory_child_tags"("family_id", "memory_id");

-- Every existing memory keeps its child as a whole-publication tag.
INSERT INTO "memory_child_tags" ("family_id", "memory_id", "child_id", "created_by")
SELECT "family_id", "id", "child_id", "author_id" FROM "memories";
