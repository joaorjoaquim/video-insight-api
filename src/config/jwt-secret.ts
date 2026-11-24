import { createHash } from 'node:crypto';

export const JWT_SECRET_MIN_BYTES = 32;

export class JwtSecretError extends Error {
  constructor(public readonly reason: 'missing' | 'too_short' | 'public') {
    super(
      reason === 'missing'
        ? 'JWT_SECRET is not set'
        : reason === 'too_short'
          ? `JWT_SECRET is shorter than ${JWT_SECRET_MIN_BYTES} bytes`
          : 'JWT_SECRET is a value published in this repository'
    );
    this.name = 'JwtSecretError';
  }
}

// SHA-256 of the two values this public repository has printed: the fallback removed from
// src/plugins/auth.ts and the placeholder in .env.example. Hashes, so the values are not repeated here.
const PUBLISHED_SECRET_HASHES = new Set([
  '883ece4331a9622e91fb2e1f7344af78dfb91f44e77a46ba3e6fc677dc5f56df',
  'ee7679367c9704174c762926a0203a9ad9dddace76d65b5f58d329a4a5e80799',
]);

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new JwtSecretError('missing');
  if (Buffer.byteLength(secret, 'utf8') < JWT_SECRET_MIN_BYTES) throw new JwtSecretError('too_short');
  if (PUBLISHED_SECRET_HASHES.has(createHash('sha256').update(secret).digest('hex'))) throw new JwtSecretError('public');
  return secret;
}
