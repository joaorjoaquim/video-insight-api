import './helpers/safe-env';
import http from 'http';
import { AddressInfo } from 'net';
import { types } from 'util';
import logger from '../src/config/logger';
import * as redisConfig from '../src/config/redis.config';
import { RefreshTokenRepository } from '../src/repositories/refresh-token.repository';
import {
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../src/services/auth.service';

jest.mock('../src/config/db.config', () => ({
  connect: jest.fn(async () => {}),
  disconnect: jest.fn(async () => {}),
}));

jest.mock('../src/repositories/refresh-token.repository', () => ({
  RefreshTokenRepository: {
    create: jest.fn((row) => row),
    save: jest.fn(async (row) => row),
    findOne: jest.fn(),
    update: jest.fn(async () => ({})),
  },
}));

const SAFE_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_REDIS: process.env.DISABLE_REDIS,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
};

const HOST = '127.0.0.1';
const TOKEN = 'cache-boot-test-token';

// Without the boot check one cache command retries for about 4.3 s. The default 5 s limit would
// report that regression as a timeout instead of the elapsed time the assertion prints.
const REGRESSION_TEST_TIMEOUT_MS = 15_000;

const repository = RefreshTokenRepository as unknown as Record<
  'create' | 'save' | 'findOne' | 'update',
  jest.Mock
>;

let info: jest.SpyInstance;
let warn: jest.SpyInstance;
let error: jest.SpyInstance;

let standIn: http.Server | undefined;
let standInRequests = 0;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, HOST, () =>
      resolve((server.address() as AddressInfo).port)
    );
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function startStandIn(respond: http.RequestListener): Promise<number> {
  standIn = http.createServer((req, res) => {
    standInRequests += 1;
    respond(req, res);
  });
  return listen(standIn);
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function answers(status: number, body: unknown): http.RequestListener {
  return (req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
}

const answersPong = answers(200, [
  { result: Buffer.from('PONG').toString('base64') },
]);
const rejectsToken = answers(401, { error: 'WRONGPASS' });
const neverAnswers: http.RequestListener = () => undefined;

function standInUrl(port: number): string {
  return `http://${HOST}:${port}`;
}

function configureUpstash(url: string, token: string): void {
  process.env.UPSTASH_REDIS_REST_URL = url;
  process.env.UPSTASH_REDIS_REST_TOKEN = token;
}

async function timeInitializeConnections(): Promise<number> {
  const startedAt = Date.now();
  await redisConfig.initializeConnections();
  return Date.now() - startedAt;
}

function cacheDisabledLogs(): unknown[] {
  return warn.mock.calls
    .filter((args) => args[1] === 'cache_disabled')
    .map((args) => args[0]);
}

// Errors raised by Node's fetch are created outside jest's module realm, where instanceof fails.
function isError(value: unknown): boolean {
  return value instanceof Error || types.isNativeError(value);
}

function expectNothingSensitiveLogged(...sensitive: string[]): void {
  const logged: unknown[] = [info, warn, error].flatMap((spy) =>
    spy.mock.calls.flat()
  );
  const serialized = JSON.stringify(logged);

  for (const value of sensitive) {
    expect(serialized).not.toContain(value);
  }

  // JSON.stringify prints an Error as {}, so the string check alone would miss one.
  for (const argument of logged) {
    expect(isError(argument)).toBe(false);
    if (typeof argument === 'object' && argument !== null) {
      for (const property of Object.values(argument)) {
        expect(isError(property)).toBe(false);
      }
    }
  }
}

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  delete process.env.DISABLE_REDIS;
  configureUpstash('', '');

  standInRequests = 0;
  jest.clearAllMocks();
  info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (standIn) {
    standIn.closeAllConnections();
    await close(standIn);
    standIn = undefined;
  }
  Object.assign(process.env, SAFE_ENV);
  jest.restoreAllMocks();
});

describe('cache check at boot (AC1) and what it logs (AC2)', () => {
  it('URL and token empty: not_configured, no request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(elapsedMs).toBeLessThan(200);
    expect(cacheDisabledLogs()).toEqual([{ reason: 'not_configured' }]);
    expectNothingSensitiveLogged();
  });

  it('URL set, token empty: not_configured, no request', async () => {
    const port = await startStandIn(answersPong);
    configureUpstash(standInUrl(port), '');

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(standInRequests).toBe(0);
    expect(elapsedMs).toBeLessThan(200);
    expect(cacheDisabledLogs()).toEqual([{ reason: 'not_configured' }]);
    expectNothingSensitiveLogged(HOST, String(port));
  });

  it('stand-in never answers: timeout after one request', async () => {
    const port = await startStandIn(neverAnswers);
    configureUpstash(standInUrl(port), TOKEN);

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(standInRequests).toBe(1);
    expect(redisConfig.CACHE_CONNECT_TIMEOUT_MS).toBe(1000);
    expect(elapsedMs).toBeGreaterThanOrEqual(950);
    expect(elapsedMs).toBeLessThan(1500);
    expect(cacheDisabledLogs()).toEqual([
      { reason: 'timeout', elapsedMs: expect.any(Number) },
    ]);
    expectNothingSensitiveLogged(TOKEN, HOST, String(port));
  });

  it('closed port: unreachable with ECONNREFUSED', async () => {
    const port = await closedPort();
    configureUpstash(standInUrl(port), TOKEN);

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(elapsedMs).toBeLessThan(500);
    expect(cacheDisabledLogs()).toEqual([
      {
        reason: 'unreachable',
        errorCode: 'ECONNREFUSED',
        elapsedMs: expect.any(Number),
      },
    ]);
    expectNothingSensitiveLogged(TOKEN, HOST, String(port));
  });

  it('stand-in answers 401 WRONGPASS: rejected after one request', async () => {
    const port = await startStandIn(rejectsToken);
    configureUpstash(standInUrl(port), TOKEN);

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(standInRequests).toBe(1);
    expect(elapsedMs).toBeLessThan(500);
    expect(cacheDisabledLogs()).toEqual([
      { reason: 'rejected', elapsedMs: expect.any(Number) },
    ]);
    expectNothingSensitiveLogged(TOKEN, HOST, String(port));
  });

  it('URL not-a-url, token set: invalid_url, no request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    configureUpstash('not-a-url', TOKEN);

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(elapsedMs).toBeLessThan(200);
    expect(cacheDisabledLogs()).toEqual([
      { reason: 'invalid_url', elapsedMs: expect.any(Number) },
    ]);
    expectNothingSensitiveLogged(TOKEN, 'not-a-url');
  });

  it('stand-in answers PONG: cache enabled after one request', async () => {
    const port = await startStandIn(answersPong);
    configureUpstash(standInUrl(port), TOKEN);

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeDefined();
    expect(standInRequests).toBe(1);
    expect(elapsedMs).toBeLessThan(500);
    expect(cacheDisabledLogs()).toEqual([]);
    expectNothingSensitiveLogged(TOKEN, HOST, String(port));
  });

  it('DISABLE_REDIS=true with a healthy stand-in: skipped, no request', async () => {
    const port = await startStandIn(answersPong);
    configureUpstash(standInUrl(port), TOKEN);
    process.env.DISABLE_REDIS = 'true';

    const elapsedMs = await timeInitializeConnections();

    expect(redisConfig.cacheService).toBeUndefined();
    expect(standInRequests).toBe(0);
    expect(elapsedMs).toBeLessThan(200);
    expect(cacheDisabledLogs()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Redis disabled for this run (DISABLE_REDIS or dev without Upstash)'
    );
    expectNothingSensitiveLogged(TOKEN, HOST, String(port));
  });
});

describe('refresh token without Upstash configured (AC3, Q2-01)', () => {
  it(
    'issues the token from Postgres without waiting on the cache',
    async () => {
      const startedAt = Date.now();
      await redisConfig.initializeConnections();
      await issueRefreshToken(1);
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(500);
      expect(redisConfig.cacheService).toBeUndefined();
      expect(repository.save).toHaveBeenCalledTimes(1);
    },
    REGRESSION_TEST_TIMEOUT_MS
  );
});

describe('refresh token callers with the cache disabled (AC4)', () => {
  beforeEach(async () => {
    const port = await startStandIn(answersPong);
    configureUpstash(standInUrl(port), '');
    await redisConfig.initializeConnections();
  });

  it('rotates a stored token through Postgres alone', async () => {
    repository.findOne.mockResolvedValueOnce({
      id: 7,
      userId: 42,
      family: 'family-a',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
    });

    const rotated = await rotateRefreshToken('incoming-refresh-token');

    expect(redisConfig.cacheService).toBeUndefined();
    expect(rotated).toEqual({
      userId: 42,
      newToken: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(repository.findOne).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(standInRequests).toBe(0);
  });

  it('revokes a token in Postgres alone', async () => {
    await revokeRefreshToken('outgoing-refresh-token');

    expect(redisConfig.cacheService).toBeUndefined();
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(standInRequests).toBe(0);
  });
});
