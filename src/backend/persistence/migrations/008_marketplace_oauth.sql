-- OLX OAuth requires exactly one credential-bearing account per workspace marketplace
-- in the v1 model. This enables atomic upsert by marketplace_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_accounts_marketplace
  ON marketplace_accounts(marketplace_id);
