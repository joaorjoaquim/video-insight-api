import './helpers/safe-env';
import type { FastifyInstance } from 'fastify';

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
jest.mock('../src/services/video.service', () => ({
  ...jest.requireActual('../src/services/video.service'),
  getVideoById: jest.fn(),
  createVideoWithCredits: jest.fn(),
}));
jest.mock('../src/services/user.service', () => ({
  ...jest.requireActual('../src/services/user.service'),
  getUserById: jest.fn(),
}));

import { buildServer } from '../src/server';
import { WriteDataSource } from '../src/config/db.config';
import { getVideoById, createVideoWithCredits } from '../src/services/video.service';
import { getUserById } from '../src/services/user.service';

const DB_TEXT = 'relation "videos" does not exist';

describe('error replies carry fixed text', () => {
  let app: FastifyInstance;
  let authorization: string;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    authorization = `Bearer ${app.jwt.sign({ userId: 1, email: 'a@example.com' })}`;
    for (const fn of [getVideoById, createVideoWithCredits, getUserById]) {
      (fn as jest.Mock).mockRejectedValue(new Error(DB_TEXT));
    }
  });
  afterAll(() => app.close());

  it.each([
    ['GET', '/video/1', 500, 'Failed to get video'],
    ['GET', '/video/1/status', 500, 'Failed to check video status'],
    ['POST', '/video', 400, 'Failed to create video'],
    ['GET', '/user/profile', 500, 'Failed to get profile'],
  ] as const)('%s %s', async (method, url, status, message) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization },
      ...(method === 'POST' ? { payload: { videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' } } : {}),
    });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ message });
    expect(res.payload).not.toContain('relation');
  });

  it('healthcheck reports down without the database message', async () => {
    (WriteDataSource.query as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED db-host.internal:5432'));
    const res = await app.inject({ method: 'GET', url: '/healthcheck' });
    expect(res.statusCode).toBe(503);
    expect(res.payload).toBe('{"status":"down","db":{"initialized":true,"latency_ms":null}}');
  });
});
