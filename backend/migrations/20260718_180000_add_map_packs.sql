CREATE TABLE IF NOT EXISTS map_packs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  description VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  updated_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_map_packs_name (name),
  KEY idx_map_packs_active_name (is_active, name),
  KEY idx_map_packs_created_by (created_by),
  KEY idx_map_packs_updated_by (updated_by),
  CONSTRAINT fk_map_packs_created_by FOREIGN KEY (created_by) REFERENCES users_extension(id) ON DELETE SET NULL,
  CONSTRAINT fk_map_packs_updated_by FOREIGN KEY (updated_by) REFERENCES users_extension(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS map_pack_maps (
  map_pack_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  map_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (map_pack_id, map_id),
  KEY idx_map_pack_maps_map (map_id),
  KEY idx_map_pack_maps_order (map_pack_id, sort_order),
  CONSTRAINT fk_map_pack_maps_pack FOREIGN KEY (map_pack_id) REFERENCES map_packs(id) ON DELETE CASCADE,
  CONSTRAINT fk_map_pack_maps_map FOREIGN KEY (map_id) REFERENCES game_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
