-- Migration: Fix wiki_articles author_id column type
-- Change author_id from BIGINT to CHAR(36) to match UUID format from users_extension.id

ALTER TABLE wiki_articles
MODIFY COLUMN author_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL;
