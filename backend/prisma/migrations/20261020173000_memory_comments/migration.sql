-- Additive COM-1 storage. No Memory updates, triggers or backfill.
CREATE TABLE memory_comments (
  id UUID NOT NULL DEFAULT uuidv7(),
  family_id UUID NOT NULL,
  memory_id UUID NOT NULL,
  author_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ(3),
  create_request_id UUID NOT NULL,
  initial_payload_hash TEXT NOT NULL,
  CONSTRAINT memory_comments_pkey PRIMARY KEY(id),
  CONSTRAINT memory_comments_version_check CHECK(version > 0),
  CONSTRAINT memory_comments_body_check CHECK((deleted_at IS NOT NULL AND body = '') OR (deleted_at IS NULL AND char_length(body) BETWEEN 1 AND 2000)),
  CONSTRAINT memory_comments_memory_id_family_id_fkey FOREIGN KEY(memory_id,family_id) REFERENCES memories(id,family_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memory_comments_author_membership_fkey FOREIGN KEY(family_id,author_id) REFERENCES family_members(family_id,user_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX memory_comments_create_marker_key ON memory_comments(family_id,author_id,create_request_id);
CREATE INDEX memory_comments_read_idx ON memory_comments(family_id,memory_id,deleted_at,created_at DESC,id DESC);
