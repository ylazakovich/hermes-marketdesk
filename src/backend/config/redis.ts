import IORedis, { Redis } from 'ioredis';
import { env, isProduction } from './env.js';
import pino from 'pino';

const logger = pino({
  level: env.logLevel,
});

let redis: Redis | null = null;

export function createRedisClient(): Redis {
  if (redis) {
    return redis;
  }

  redis = new IORedis({
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password || undefined,
    db: 0,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
  });

  redis.on('error', (err: Error) => {
    logger.error({ error: err }, 'Redis connection error');
  });

  redis.on('connect', () => {
    logger.info('Redis client connected');
  });

  redis.on('reconnecting', () => {
    logger.warn('Redis client reconnecting');
  });

  return redis;
}

export async function getRedis(): Promise<Redis> {
  if (!redis) {
    createRedisClient();
  }
  return redis!;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing Redis');
  await closeRedis();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing Redis');
  await closeRedis();
  process.exit(0);
});
