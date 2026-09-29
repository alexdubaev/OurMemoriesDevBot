ALTER TABLE "families" DROP CONSTRAINT "families_max_backup_chat_id_positive";
ALTER TABLE "families" ADD CONSTRAINT "families_max_backup_chat_id_nonzero" CHECK ("max_backup_chat_id" IS NULL OR "max_backup_chat_id" <> 0);
