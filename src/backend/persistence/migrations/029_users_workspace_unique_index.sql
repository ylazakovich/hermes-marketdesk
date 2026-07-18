-- This file intentionally contains one statement so the migration runner executes
-- CREATE INDEX CONCURRENTLY outside an explicit or implicit multi-statement transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_workspace_id
  ON users(workspace_id, id);
