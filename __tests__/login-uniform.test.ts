import './helpers/safe-env';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';

jest.mock('../src/config/redis.config', () => ({
  initializeConnections: jest.fn(async () => {}),
  disconnectConnections: jest.fn(async () => {}),
  cacheService: undefined,
}));
jest.mock('../src/services/user.service', () => ({
  ...jest.requireActual('../src/services/user.service'),
  getUserByEmail: jest.fn(),
}));

import { buildServer } from '../src/server';
import { getUserByEmail } from '../src/services/user.service';

const findByEmail = getUserByEmail as jest.Mock;

describe('failed logins cannot be told apart', () => {
  let app: FastifyInstance;
  let storedHash: string;
  const compare = jest.spyOn(bcrypt, 'compare');

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
    storedHash = await bcrypt.hash('the-right-one', 4);
  });
  afterAll(() => app.close());

  async function attempt(user: object | null) {
    findByEmail.mockResolvedValue(user);
    compare.mockClear();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'a-wrong-one' },
    });
    return { status: res.statusCode, payload: res.payload, comparisons: compare.mock.calls.length };
  }

  it('unknown e-mail, OAuth-only account and wrong password answer the same and cost the same', async () => {
    const unknown = await attempt(null);
    const oauthOnly = await attempt({ id: 1, email: 'a@example.com', password: null });
    const wrongPassword = await attempt({ id: 1, email: 'a@example.com', password: storedHash });

    expect(unknown).toEqual({ status: 401, payload: '{"message":"Invalid email or password"}', comparisons: 1 });
    expect(oauthOnly).toEqual(unknown);
    expect(wrongPassword).toEqual(unknown);
  });
});
