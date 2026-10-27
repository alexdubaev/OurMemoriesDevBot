-- Persist a stop event so queued pilot deliveries fail closed after worker restart.
ALTER TYPE max_inbox_event_kind ADD VALUE 'bot_stopped';
