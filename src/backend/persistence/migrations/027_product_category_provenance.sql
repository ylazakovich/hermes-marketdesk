ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_provenance JSONB;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_provenance_shape;

ALTER TABLE products
  ADD CONSTRAINT products_category_provenance_shape
  CHECK (
    category_provenance IS NULL
    OR (
      jsonb_typeof(category_provenance) = 'object'
      AND COALESCE(
        category_provenance->>'status' IN ('synced', 'conflict'),
        FALSE
      )
    )
  );

COMMENT ON COLUMN products.category_provenance IS
  'Trusted marketplace category source or an unresolved multi-listing category conflict';