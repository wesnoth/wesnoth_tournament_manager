-- Phase 2: Create wiki_article_images junction table with corrected FK types

CREATE TABLE IF NOT EXISTS wiki_article_images (
  article_id BIGINT NOT NULL,
  wiki_image_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When the link was created',
  
  PRIMARY KEY (article_id, wiki_image_id),
  
  CONSTRAINT fk_wiki_article_images_article
    FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  
  CONSTRAINT fk_wiki_article_images_image
    FOREIGN KEY (wiki_image_id) REFERENCES wiki_images(id) ON DELETE CASCADE ON UPDATE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Junction table linking wiki articles to images used in them (N:M relationship)';
