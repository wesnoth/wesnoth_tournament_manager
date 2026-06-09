-- Phase 2: Create wiki_article_images junction table
CREATE TABLE IF NOT EXISTS wiki_article_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  wiki_article_id BIGINT NOT NULL COMMENT 'Reference to wiki_articles',
  wiki_image_id BIGINT NOT NULL COMMENT 'Reference to wiki_images',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When this reference was created',
  
  UNIQUE KEY uk_article_image (wiki_article_id, wiki_image_id) COMMENT 'Each image used only once per article',
  
  CONSTRAINT fk_wiki_article_images_article 
    FOREIGN KEY (wiki_article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wiki_article_images_image 
    FOREIGN KEY (wiki_image_id) REFERENCES wiki_images(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Junction table linking wiki articles to images they reference';
