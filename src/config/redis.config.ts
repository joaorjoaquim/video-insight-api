import { CacheService, usesUpstash } from '../services/cache.service';
import { connect as connectDB, disconnect as disconnectDB } from './db.config';
import logger from './logger';

export let cacheService: CacheService | undefined;

export const CACHE_CONNECT_TIMEOUT_MS = 1000;

class CacheConnectTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CacheConnectTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function disabledReason(err: unknown): { reason: string; errorCode?: string } {
  const e = err as { name?: string; cause?: { code?: unknown } };
  if (err instanceof CacheConnectTimeout) return { reason: 'timeout' };
  if (e?.name === 'UrlError') return { reason: 'invalid_url' };
  if (e?.name === 'UpstashError') return { reason: 'rejected' };
  if (typeof e?.cause?.code === 'string') return { reason: 'unreachable', errorCode: e.cause.code };
  return { reason: 'error' };
}

async function initializeCache(): Promise<void> {
  cacheService = undefined;

  const skipRedis =
    process.env.DISABLE_REDIS === 'true' ||
    (process.env.NODE_ENV === 'development' && !process.env.UPSTASH_REDIS_REST_URL);
  if (skipRedis) {
    logger.warn('Redis disabled for this run (DISABLE_REDIS or dev without Upstash)');
    return;
  }

  if (usesUpstash() && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
    logger.warn({ reason: 'not_configured' }, 'cache_disabled');
    return;
  }

  const startedAt = Date.now();
  try {
    const candidate = new CacheService();
    await withTimeout(candidate.connect(), CACHE_CONNECT_TIMEOUT_MS);
    cacheService = candidate;
  } catch (err) {
    logger.warn({ ...disabledReason(err), elapsedMs: Date.now() - startedAt }, 'cache_disabled');
  }
}

export async function initializeConnections() {
  await initializeCache();
  await connectDB();
}

export async function disconnectConnections() {
  if (cacheService) {
    await cacheService.disconnect();
  }

  await disconnectDB();
}