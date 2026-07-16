-- Migration 021: use a monotonic revision for marketplace OAuth account CAS.
-- PostgreSQL timestamps preserve microseconds while JavaScript Date preserves only
-- milliseconds, so exact updated_at comparisons can reject unchanged rows.
--
-- PostgreSQL 11+ installs a constant DEFAULT without rewriting existing rows. A
-- validated NOT VALID check lets SET NOT NULL reuse proof instead of rescanning.

ALTER TABLE marketplace_accounts
  ADD COLUMN IF NOT EXISTS revision BIGINT DEFAULT 1;

ALTER TABLE marketplace_accounts
  ALTER COLUMN revision SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'marketplace_accounts'::regclass
      AND conname = 'marketplace_accounts_revision_not_null'
  ) THEN
    ALTER TABLE marketplace_accounts
      ADD CONSTRAINT marketplace_accounts_revision_not_null
      CHECK (revision IS NOT NULL) NOT VALID;
  END IF;
END
$$;

ALTER TABLE marketplace_accounts
  VALIDATE CONSTRAINT marketplace_accounts_revision_not_null;

ALTER TABLE marketplace_accounts
  ALTER COLUMN revision SET NOT NULL;

ALTER TABLE marketplace_accounts
  DROP CONSTRAINT marketplace_accounts_revision_not_null;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'marketplace_accounts'::regclass
      AND conname = 'marketplace_accounts_revision_positive'
  ) THEN
    ALTER TABLE marketplace_accounts
      ADD CONSTRAINT marketplace_accounts_revision_positive
      CHECK (revision > 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE marketplace_accounts
  VALIDATE CONSTRAINT marketplace_accounts_revision_positive;
