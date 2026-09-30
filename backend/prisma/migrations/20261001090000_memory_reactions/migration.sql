CREATE TYPE "memory_reaction" AS ENUM ('heart', 'love', 'laugh', 'touched', 'wow', 'clap');
ALTER TABLE "memory_likes"
  ADD COLUMN "reaction" "memory_reaction" NOT NULL DEFAULT 'heart';
