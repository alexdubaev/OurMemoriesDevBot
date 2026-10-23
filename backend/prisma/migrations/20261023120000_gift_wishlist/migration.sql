-- Additive gift wishlist storage. No backfill, no changes to existing rows.
-- The new enum value is only added here; PostgreSQL forbids using it in the same transaction.
ALTER TYPE "media_asset_purpose" ADD VALUE 'gift';

CREATE TABLE gifts (
  id UUID NOT NULL DEFAULT uuidv7(),
  family_id UUID NOT NULL,
  child_id UUID NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price TEXT,
  photo_media_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL,
  reserved_by_user_id UUID,
  reserved_at TIMESTAMPTZ(3),
  bought_at TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT gifts_pkey PRIMARY KEY(id),
  CONSTRAINT gifts_version_check CHECK(version > 0),
  CONSTRAINT gifts_title_check CHECK(char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT gifts_url_check CHECK(char_length(url) BETWEEN 1 AND 2048),
  CONSTRAINT gifts_price_check CHECK(price IS NULL OR char_length(price) BETWEEN 1 AND 30),
  CONSTRAINT gifts_reservation_pair_check CHECK((reserved_by_user_id IS NULL) = (reserved_at IS NULL)),
  CONSTRAINT gifts_bought_requires_reservation_check CHECK(bought_at IS NULL OR reserved_by_user_id IS NOT NULL),
  CONSTRAINT gifts_family_id_fkey FOREIGN KEY(family_id) REFERENCES families(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT gifts_child_id_family_id_fkey FOREIGN KEY(child_id,family_id) REFERENCES children(id,family_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT gifts_photo_media_id_family_id_fkey FOREIGN KEY(photo_media_id,family_id) REFERENCES media_assets(id,family_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT gifts_creator_membership_fkey FOREIGN KEY(family_id,created_by_user_id) REFERENCES family_members(family_id,user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT gifts_reserver_membership_fkey FOREIGN KEY(family_id,reserved_by_user_id) REFERENCES family_members(family_id,user_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX gifts_photo_media_id_key ON gifts(photo_media_id);
CREATE INDEX gifts_family_id_child_id_idx ON gifts(family_id,child_id);
