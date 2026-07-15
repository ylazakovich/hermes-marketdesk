-- This file intentionally contains one statement so the migration runner executes
-- CREATE INDEX CONCURRENTLY outside an explicit or implicit multi-statement transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_marketplace_external_unique
  ON listings(marketplace_id, marketplace_listing_id)
  WHERE marketplace_listing_id IS NOT NULL;
