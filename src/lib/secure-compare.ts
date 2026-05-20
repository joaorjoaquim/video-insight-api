import { timingSafeEqual, createHash } from 'crypto';

/**
 * Constant-time string comparison. Hashes both values first so
 * buffers are always the same length regardless of input length,
 * preventing length-based timing oracles.
 */
export function secureCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const aHash = createHash('sha256').update(a).digest();
    const bHash = createHash('sha256').update(b).digest();
    return timingSafeEqual(aHash, bHash);
  } catch {
    return false;
  }
}
