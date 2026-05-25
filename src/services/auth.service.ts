import crypto from 'crypto';
import { FastifyReply } from 'fastify';
import { cacheService } from '../config/redis.config';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';

const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REFRESH_TTL_MS = REFRESH_TTL_SECONDS * 1000;

const COOKIE_BASE = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  maxAge: REFRESH_TTL_SECONDS,
};

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function redisKey(hash: string): string {
  return `refresh:${hash}`;
}

function cookieOptions() {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const useSecure = frontendUrl.startsWith('https://');
  const domain = process.env.COOKIE_DOMAIN;
  return {
    ...COOKIE_BASE,
    secure: useSecure,
    ...(domain ? { domain } : {}),
  };
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('refresh_token', token, cookieOptions());
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie('refresh_token', {
    path: '/',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
}

async function saveToDb(hash: string, userId: number, family: string): Promise<void> {
  const repo = RefreshTokenRepository;
  await repo.save(
    repo.create({
      tokenHash: hash,
      userId,
      family,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
  );
}

export async function issueRefreshToken(userId: number, family?: string): Promise<string> {
  const token = generateToken();
  const hash = hashToken(token);
  const tokenFamily = family ?? generateToken();

  if (cacheService) {
    try {
      await cacheService.set(redisKey(hash), { userId, family: tokenFamily }, REFRESH_TTL_SECONDS);
      return token;
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  await saveToDb(hash, userId, tokenFamily);
  return token;
}

export async function rotateRefreshToken(
  incomingToken: string
): Promise<{ userId: number; newToken: string } | null> {
  const hash = hashToken(incomingToken);

  if (cacheService) {
    try {
      const record = await cacheService.get<{ userId: number; family: string }>(redisKey(hash));
      if (record) {
        await cacheService.del(redisKey(hash));
        const newToken = await issueRefreshToken(record.userId, record.family);
        return { userId: record.userId, newToken };
      }
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  const record = await RefreshTokenRepository.findOne({
    where: { tokenHash: hash, revoked: false },
  });

  if (!record || record.expiresAt < new Date()) return null;

  await RefreshTokenRepository.update(record.id, { revoked: true });
  const newToken = await issueRefreshToken(record.userId, record.family ?? undefined);
  return { userId: record.userId, newToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = hashToken(token);

  if (cacheService) {
    try {
      await cacheService.del(redisKey(hash));
      return;
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  await RefreshTokenRepository.update({ tokenHash: hash }, { revoked: true });
}
