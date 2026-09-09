-- CreateEnum
CREATE TYPE "memory_kind" AS ENUM ('note', 'photo', 'video', 'voice');

-- CreateEnum
CREATE TYPE "memory_status" AS ENUM ('processing', 'published', 'failed', 'deleted');

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "child_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "kind" "memory_kind" NOT NULL,
    "body" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "memory_status" NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memories_version_positive" CHECK ("version" > 0),
    CONSTRAINT "memories_soft_delete_consistent" CHECK (("status" = 'deleted') = ("deleted_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "memory_likes" (
    "family_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_likes_pkey" PRIMARY KEY ("memory_id", "user_id")
);

-- CreateTable
CREATE TABLE "memory_media" (
    "family_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "memory_media_pkey" PRIMARY KEY ("memory_id", "position"),
    CONSTRAINT "memory_media_position_nonnegative" CHECK ("position" >= 0)
);

-- CreateIndex
CREATE INDEX "memories_feed_idx" ON "memories"("family_id", "status", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "memories_kind_feed_idx" ON "memories"("family_id", "kind", "status", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "memories_id_family_id_key" ON "memories"("id", "family_id");

-- CreateIndex
CREATE INDEX "memory_likes_family_id_memory_id_idx" ON "memory_likes"("family_id", "memory_id");

-- CreateIndex
CREATE INDEX "memory_media_family_id_media_id_idx" ON "memory_media"("family_id", "media_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_media_media_id_key" ON "memory_media"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "children_id_family_id_key" ON "children"("id", "family_id");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_child_id_family_id_fkey" FOREIGN KEY ("child_id", "family_id") REFERENCES "children"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_likes" ADD CONSTRAINT "memory_likes_memory_id_family_id_fkey" FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_likes" ADD CONSTRAINT "memory_likes_family_id_user_id_fkey" FOREIGN KEY ("family_id", "user_id") REFERENCES "family_members"("family_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_media" ADD CONSTRAINT "memory_media_memory_id_family_id_fkey" FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
