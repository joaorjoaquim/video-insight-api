import { CacheService } from '../services/cache.service';
import { connect as connectDB, disconnect as disconnectDB } from './db.config';
import logger from './logger';

export let cacheService: CacheService | undefined;

export async function initializeConnections() {
  const skipRedis =
    process.env.DISABLE_REDIS === 'true' ||
    (process.env.NODE_ENV === 'development' &&
      !process.env.UPSTASH_REDIS_REST_URL);

  if (skipRedis) {
    logger.warn('Redis disabled for this run (DISABLE_REDIS or dev without Upstash)');
    cacheService = undefined;
  } else {
    cacheService = new CacheService();
    try {
      await Promise.race([
        cacheService.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connect timeout')), 3000)
        ),
      ]);
    } catch (err) {
      logger.warn(
        { err },
        'Cache unavailable — API will run without Redis'
      );
      cacheService = undefined;
    }
  }

  await connectDB();
}

export async function disconnectConnections() {
  if (cacheService) {
    await cacheService.disconnect();
  }

  await disconnectDB();
}