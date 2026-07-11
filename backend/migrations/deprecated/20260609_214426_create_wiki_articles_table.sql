-- Phase 1: Create wiki_articles table for integrated help system
-- This table stores wiki articles that can be navigated and referenced as contextual help

CREATE TABLE IF NOT EXISTS wiki_articles (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE COMMENT 'URL-friendly identifier (e.g. "getting-started", "tournament-rules")',
  title VARCHAR(255) NOT NULL COMMENT 'Article title, displayed in headers',
  content_markdown LONGTEXT NOT NULL COMMENT 'Article content in Markdown format (sanitized and rendered on frontend)',
  language VARCHAR(10) NOT NULL DEFAULT 'en' COMMENT 'Language code (en, es, fr, etc.) for i18n support',
  author_id BIGINT COMMENT 'User ID of the article author (admin/moderator) - validated in backend, no FK constraint',
  is_published TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Publication status (1=published, 0=draft)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Article creation timestamp',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last modification timestamp',
  
  -- Indices for common queries
  INDEX idx_slug_language (slug, language) COMMENT 'Fast lookup by slug+language',
  INDEX idx_language_published (language, is_published) COMMENT 'Fast filtering for navigation',
  INDEX idx_author_id (author_id) COMMENT 'Find articles by author',
  INDEX idx_created_at (created_at) COMMENT 'Sort articles by date'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci 
  COMMENT='Wiki articles for integrated help system - Wesnoth Tournament Manager';

-- Seed articles for MVP (optional, can be removed if managing via admin UI)
INSERT INTO wiki_articles (slug, title, content_markdown, language, is_published)
VALUES 
  ('getting-started', 'Getting Started', '# Getting Started\n\nWelcome to the Wesnoth Tournament Manager! This guide will help you navigate the platform.\n\n## Creating an Account\n\nYou can register using your Wesnoth forum account.', 'en', 1),
  ('tournament-rules', 'Tournament Rules', '# Tournament Rules\n\n## Match Format\n\n- Matches are 1v1 or team-based\n- Players must confirm results within 24 hours', 'en', 1),
  ('inicio', 'Cómo Empezar', '# Cómo Empezar\n\nBienvenido al Administrador de Torneos de Wesnoth.', 'es', 1);
