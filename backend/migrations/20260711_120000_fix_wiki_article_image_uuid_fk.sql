-- Align the wiki image junction table with the UUID article model.
-- Existing environments have no article-image rows, so the conversion is lossless.

ALTER TABLE wiki_article_images
  DROP FOREIGN KEY fk_wiki_article_images_article;

ALTER TABLE wiki_article_images
  MODIFY COLUMN article_id CHAR(36)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

ALTER TABLE wiki_article_images
  ADD CONSTRAINT fk_wiki_article_images_article
    FOREIGN KEY (article_id) REFERENCES wiki_articles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
