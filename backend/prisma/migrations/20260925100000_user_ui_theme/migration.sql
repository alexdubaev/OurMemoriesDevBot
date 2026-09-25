ALTER TABLE "users"
ADD COLUMN "ui_theme" VARCHAR(16) NOT NULL DEFAULT 'mint';

ALTER TABLE "users"
ADD CONSTRAINT "users_ui_theme_check"
CHECK ("ui_theme" IN ('mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'));
