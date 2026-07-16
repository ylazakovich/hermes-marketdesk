-- Migration 021: use a monotonic revision for marketplace OAuth account CAS.
-- PostgreSQL timestamps preserve microseconds while JavaScript Date preserves only
-- milliseconds, so exact updated_at comparisons can reject unchanged rows.

ALTER TABLE marketplace_accounts
  ADD COLUMN IF NOT EXISTS revision BIGINT;

UPDATE marketplace_accounts
SET revision = 1
WHERE revision IS NULL;

ALTER TABLE marketplace_accounts
  ALTER COLUMN revision SET DEFAULT 1,
  ALTER COLUMN revision SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'marketplace_accounts'::regclass
      AND conname = 'marketplace_accounts_revision_positive'
  ) THEN
    ALTER TABLE marketplace_accounts
      ADD CONSTRAINT marketplace_accounts_revision_positive CHECK (revision > 0);
  END IF;
END
$$;
