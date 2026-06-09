-- Phase 2: Fix wiki_images table - use CHAR(36) for uploaded_by to match users_extension.id type

CREATE TABLE IF NOT EXISTS wiki_images (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE COMMENT 'Filename stored in /uploads/wiki/',
  original_name VARCHAR(255) NOT NULL COMMENT 'Original filename as uploaded by user',
  uploaded_by CHAR(36) COMMENT 'User ID (UUID) who uploaded the image',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Upload timestamp',
  
  INDEX idx_filename (filename) COMMENT 'Fast lookup by filename',
  INDEX idx_uploaded_by (uploaded_by) COMMENT 'Find images by uploader',
  
  CONSTRAINT fk_wiki_images_uploader 
    FOREIGN KEY (uploaded_by) REFERENCES users_extension(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='Wiki image metadata - tracks uploaded images and their authors';
