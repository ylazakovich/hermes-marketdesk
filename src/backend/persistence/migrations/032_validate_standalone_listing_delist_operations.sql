-- Validate separately so migration 031 does not scan the operation table while
-- holding the stronger ADD CONSTRAINT lock.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operation_recommendation_check'
       AND NOT convalidated
  ) THEN
    ALTER TABLE category_correction_operations
      VALIDATE CONSTRAINT category_correction_operation_recommendation_check;
  END IF;
END
$$;