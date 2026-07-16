import path from 'path';
import fs from 'fs';
import type { PoolClient } from 'pg';
import { createPool, closePool } from '../config/database.js';
import pino from 'pino';

const logger = pino();
const migrationsDir = path.join(process.cwd(), 'src/backend/persistence/migrations');
const MIGRATION_LOCK_KEY = 'marketdesk:migrations';

async function runMigrations() {
  const pool = createPool();
  let client: PoolClient | undefined;
  let locked = false;

  try {
    logger.info('Starting database migrations...');

    // Get all migration files
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.warn('No migration files found');
      return;
    }

    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY]);
    locked = true;

    // All lexically ordered migrations share one session lock. The lock survives
    // transaction boundaries, so concurrent index DDL can remain standalone.
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        logger.info(`Running migration: ${file}`);
        if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql)) {
          // Concurrent index DDL must run outside a transaction. Invalid remnants
          // are inspected and removed under the same suite-wide session lock.
          const indexMatch = sql.match(
            /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i
          );
          if (!indexMatch) throw new Error(`Cannot identify concurrent index in ${file}`);
          const indexName = indexMatch[1];
          const validity = await client.query<{ indisvalid: boolean }>(
            `SELECT index.indisvalid
               FROM pg_class relation
               JOIN pg_index index ON index.indexrelid = relation.oid
              WHERE relation.relname = $1 AND pg_table_is_visible(relation.oid)`,
            [indexName]
          );
          if (validity.rows[0] && !validity.rows[0].indisvalid) {
            await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`);
          }
          await client.query(sql);
        } else {
          await client.query(sql);
        }
        logger.info(`Completed migration: ${file}`);
      } catch (error) {
        logger.error({ error, file }, `Failed to run migration: ${file}`);
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    if (client && locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_KEY]);
      } catch (unlockError) {
        logger.warn({ error: unlockError }, 'Failed to release migration advisory lock');
      }
    }
    client?.release();
    await closePool();
  }
}

runMigrations();
