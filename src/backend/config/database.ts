import { Pool, PoolClient } from 'pg';
import { env, isProduction } from './env.js';
import pino from 'pino';

const logger = pino({
  level: env.logLevel,
});

let pool: Pool | null = null;

export function createPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = env.database.url ||
    `postgresql://${env.database.user}:${env.database.password}@${env.database.host}:${env.database.port}/${env.database.name}`;

  pool = new Pool({
    connectionString,
    min: env.database.poolMin,
    max: env.database.poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: env.appName,
    ssl: isProduction ? { rejectUnauthorized: true } : false,
  });

  pool.on('error', (err: Error) => {
    logger.error({ error: err }, 'Unexpected error on idle client');
    process.exit(-1);
  });

  return pool;
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    createPool();
  }
  return pool!;
}

export async function query<T = any>(
  text: string,
  values?: any[],
  client?: PoolClient,
): Promise<{ rows: T[]; rowCount: number }> {
  const currentPool = client || (await getPool());

  try {
    const start = Date.now();
    const result = await currentPool.query(text, values);
    const duration = Date.now() - start;

    if (duration > 1000) {
      // Never log the values array — it carries bcrypt hashes, PII and prices.
      // The param count is enough to correlate with the query text. (S3)
      logger.warn(
        { duration, query: text, paramCount: values?.length ?? 0, values: '[redacted]' },
        'Slow query detected',
      );
    }

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0,
    };
  } catch (error) {
    // Redact bound values here too (S3).
    logger.error(
      { error, query: text, paramCount: values?.length ?? 0, values: '[redacted]' },
      'Database query error',
    );
    throw error;
  }
}

export async function getClient(): Promise<PoolClient> {
  const currentPool = await getPool();
  return currentPool.connect();
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Transaction rolled back');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await closePool();
  process.exit(0);
});
