-- Expand only: legacy MemoryComment/MemoryLike and album DTOs remain unchanged.
ALTER TABLE album_entries ADD COLUMN discussion_generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE album_entries ADD CONSTRAINT album_entries_discussion_generation_check CHECK (discussion_generation > 0);

CREATE TABLE album_entry_comments (
  id UUID NOT NULL DEFAULT uuidv7(),
  family_id UUID NOT NULL,
  album_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  discussion_generation INTEGER NOT NULL CHECK (discussion_generation > 0),
  author_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at TIMESTAMPTZ(3),
  create_request_id UUID NOT NULL,
  initial_payload_hash TEXT NOT NULL,
  CONSTRAINT album_entry_comments_pkey PRIMARY KEY (id),
  CONSTRAINT album_entry_comments_entry_scope_fkey FOREIGN KEY (entry_id, album_id, family_id) REFERENCES album_entries(id, album_id, family_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT album_entry_comments_author_membership_fkey FOREIGN KEY (family_id, author_id) REFERENCES family_members(family_id, user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT album_entry_comments_body_check CHECK (deleted_at IS NOT NULL OR char_length(body) BETWEEN 1 AND 2000)
);
-- This durable marker intentionally survives chapter clear and executor TTL expiry.
CREATE UNIQUE INDEX album_entry_comments_create_marker_key ON album_entry_comments(family_id, author_id, create_request_id);
CREATE INDEX album_entry_comments_read_idx ON album_entry_comments(family_id, album_id, entry_id, discussion_generation, deleted_at, created_at DESC, id DESC);

CREATE TABLE album_entry_reactions (
  family_id UUID NOT NULL,
  album_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  discussion_generation INTEGER NOT NULL CHECK (discussion_generation > 0),
  user_id UUID NOT NULL,
  reaction "memory_reaction" NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT album_entry_reactions_pkey PRIMARY KEY (entry_id, user_id),
  CONSTRAINT album_entry_reactions_entry_scope_fkey FOREIGN KEY (entry_id, album_id, family_id) REFERENCES album_entries(id, album_id, family_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT album_entry_reactions_member_fkey FOREIGN KEY (family_id, user_id) REFERENCES family_members(family_id, user_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX album_entry_reactions_read_idx ON album_entry_reactions(family_id, album_id, entry_id, discussion_generation);
