ALTER TABLE "caption_requests"
  ADD CONSTRAINT "caption_requests_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "caption_requests_memory_id_family_id_fkey"
    FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "caption_requests_family_id_user_id_fkey"
    FOREIGN KEY ("family_id", "user_id") REFERENCES "family_members"("family_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
