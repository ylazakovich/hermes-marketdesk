ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_provenance JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_category_provenance_shape'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_category_provenance_shape
      CHECK (
        category_provenance IS NULL
        OR (
          jsonb_typeof(category_provenance) = 'object'
          AND category_provenance->>'status' IN ('synced', 'conflict')
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN products.category_provenance IS
  'Trusted marketplace category source or an unresolved multi-listing category conflict';