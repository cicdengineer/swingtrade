CREATE TABLE IF NOT EXISTS seasonality_json_database (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  schema_version INT NOT NULL DEFAULT 1,
  data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK (JSON_VALID(data))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seasonality_json_collections (
  document_id VARCHAR(64) NOT NULL,
  collection_name VARCHAR(64) NOT NULL,
  shard_key VARCHAR(128) NOT NULL,
  data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, collection_name, shard_key),
  INDEX idx_seasonality_json_collections_name (collection_name),
  CHECK (JSON_VALID(data))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
