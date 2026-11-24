import './helpers/safe-env';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

jest.mock('../src/config/redis.config', () => ({
  initializeConnections: jest.fn(async () => {}),
  disconnectConnections: jest.fn(async () => {}),
  cacheService: undefined,
}));
jest.mock('../src/config/db.config', () => {
  const source = { isInitialized: true, query: jest.fn(), getRepository: jest.fn(() => ({})) };
  return {
    WriteDataSource: source,
    ReadDataSource: source,
    connectionSource: source,
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
  };
});

import { buildServer } from '../src/server';
import { connect } from '../src/config/db.config';
import { JwtSecretError, requireJwtSecret } from '../src/config/jwt-secret';
import handler from '../src/api/index';

// Both values are already public: the first was the fallback in src/plugins/auth.ts, the second is read
// from the tracked template so the check cannot drift from it.
const OLD_FALLBACK = ['supersecret', 'ultrapassword', '1234567890'].join('-');
const PLACEHOLDER = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', '.env.example'))).JWT_SECRET;

const VALID = process.env.JWT_SECRET as string;

function reasonFor(value: string | undefined): string {
  if (value === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = value;
  try {
    requireJwtSecret();
    return 'accepted';
  } catch (error) {
    return error instanceof JwtSecretError ? error.reason : 'other';
  }
}

afterEach(() => {
  process.env.JWT_SECRET = VALID;
});

describe('requireJwtSecret', () => {
  it('refuses a missing, short or published value', () => {
    expect(reasonFor(undefined)).toBe('missing');
    expect(reasonFor('')).toBe('missing');
    expect(reasonFor('a'.repeat(31))).toBe('too_short');
    expect(reasonFor(OLD_FALLBACK)).toBe('public');
    expect(Buffer.byteLength(PLACEHOLDER, 'utf8')).toBeGreaterThanOrEqual(32);
    expect(reasonFor(PLACEHOLDER)).toBe('public');
  });

  it('counts bytes, not characters', () => {
    expect(reasonFor('a'.repeat(32))).toBe('accepted');
    expect(reasonFor('é'.repeat(16))).toBe('accepted');
  });
});

describe('boot', () => {
  it('ready() rejects without a usable secret and resolves with one', async () => {
    delete process.env.JWT_SECRET;
    await expect(buildServer().ready()).rejects.toThrow('JWT_SECRET is not set');

    process.env.JWT_SECRET = 'a'.repeat(31);
    await expect(buildServer().ready()).rejects.toThrow('JWT_SECRET is shorter than 32 bytes');

    process.env.JWT_SECRET = 'a'.repeat(32);
    const app = buildServer();
    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });

  it('the Vercel handler answers 503 and never reaches the database', async () => {
    delete process.env.JWT_SECRET;
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: 'Service temporarily unavailable', code: 'CONFIG_INVALID' });
    expect(connect).not.toHaveBeenCalled();
  });
});
