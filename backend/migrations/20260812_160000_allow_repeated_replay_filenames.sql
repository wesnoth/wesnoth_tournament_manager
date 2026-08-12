-- Replay filenames are not globally unique on the Wesnoth replay server.
-- The forum identity is instance_uuid + game_id and remains the idempotency key.
ALTER TABLE replays DROP INDEX replay_filename;
