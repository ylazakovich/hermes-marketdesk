import fs from 'node:fs';
import path from 'node:path';

describe('persistent settings migration', () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/backend/persistence/migrations/030_persistent_settings_contracts.sql'
    ),
    'utf8'
  );
  const indexMigration = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/backend/persistence/migrations/029_users_workspace_unique_index.sql'
    ),
    'utf8'
  );
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/schema.sql'),
    'utf8'
  );
  const agentsMigration = fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/migrations/040_marketdesk_agents.sql'),
    'utf8'
  );

  it('backfills and constrains workspace language idempotently', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS language');
    expect(migration).toContain("UPDATE workspaces SET language = 'en'");
    expect(migration).toContain('workspaces_language_not_null');
    expect(migration).toContain('NOT VALID');
    expect(migration).toContain('VALIDATE CONSTRAINT workspaces_language_not_null');
    expect(migration).toContain('ALTER COLUMN language SET NOT NULL');
    expect(migration).toContain('workspaces_language_valid');
    expect(migration).toContain("conrelid = 'workspaces'::regclass");
    expect(migration).not.toContain('uq_users_workspace_id');
    expect(indexMigration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_workspace_id'
    );
    expect(schema).toContain("language VARCHAR(10) NOT NULL DEFAULT 'en'");
    expect(schema).toContain("hermes_creativity_preset VARCHAR(20) NOT NULL DEFAULT 'balanced'");
    expect(schema).toContain('listing_seo_enabled BOOLEAN NOT NULL DEFAULT TRUE');
  });

  it('adds product-scoped Hermes agent provenance with tenant-safe deduplication', () => {
    expect(agentsMigration).toContain('ADD COLUMN IF NOT EXISTS hermes_creativity_preset');
    expect(agentsMigration).toContain('ADD COLUMN IF NOT EXISTS listing_seo_enabled');
    expect(agentsMigration).toContain('CREATE TABLE IF NOT EXISTS hermes_agent_recommendations');
    expect(agentsMigration).toContain('workspace_id UUID NOT NULL REFERENCES workspaces(id)');
    expect(agentsMigration).toContain('product_id UUID NOT NULL REFERENCES products(id)');
    expect(agentsMigration).toContain('recommendation_fingerprint CHAR(64) NOT NULL');
    expect(agentsMigration).toContain('idx_hermes_agent_recommendation_dedup');
  });

  it('uses normalized, tenant-and-user-scoped preference tables without JSONB', () => {
    for (const sql of [migration, schema]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_preferences');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS notification_preferences');
      expect(sql).toContain(
        'FOREIGN KEY (workspace_id, user_id) REFERENCES users(workspace_id, id)'
      );
      const userTable = sql.match(
        /CREATE TABLE IF NOT EXISTS user_preferences \([\s\S]*?\n\);/
      )?.[0];
      const notificationTable = sql.match(
        /CREATE TABLE IF NOT EXISTS notification_preferences \([\s\S]*?\n\);/
      )?.[0];
      expect(userTable).toBeDefined();
      expect(notificationTable).toBeDefined();
      expect(`${userTable}${notificationTable}`).not.toMatch(/JSONB/i);
    }
  });
});
