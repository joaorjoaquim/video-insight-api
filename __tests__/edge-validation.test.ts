import './helpers/safe-env';
import type { FastifyInstance, RouteOptions } from 'fastify';

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
import { initializeConnections } from '../src/config/redis.config';
import { getUserByEmail } from '../src/services/user.service';

const dbHook = initializeConnections as jest.Mock;
const findByEmail = getUserByEmail as jest.Mock;

const VALID_BODIES: Record<string, Record<string, unknown>> = {
  'POST /auth/signup': { email: 'a@example.com', password: 'abcdef1' },
  'POST /auth/login': { email: 'a@example.com', password: 'abcdef1' },
  'POST /video': { videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
  'POST /credits/redeem': { code: 'WELCOME' },
  'POST /credits/claim/github': { action: 'star' },
  'POST /credits/admin/grant': { userId: 1, amount: 5, description: 'abc' },
  'POST /credits/admin/deduct': { userId: 1, amount: 5, description: 'abc' },
  'POST /credits/admin/promo': { code: 'X', credits: 5 },
};

async function buildApp(onRoute?: (route: RouteOptions) => void): Promise<FastifyInstance> {
  const app = buildServer();
  if (onRoute) app.addHook('onRoute', onRoute);
  await app.ready();
  return app;
}

describe('request bodies', () => {
  let app: FastifyInstance;
  const withBody: RouteOptions[] = [];

  beforeAll(async () => {
    app = await buildApp((route) => {
      if (route.schema?.body) withBody.push(route);
    });
  });
  afterAll(() => app.close());

  it('every route with a body schema refuses undeclared fields', () => {
    const names = withBody.map((r) => `${r.method} ${r.url.replace(/(.)\/$/, '$1')}`).sort();
    expect(names).toEqual(Object.keys(VALID_BODIES).sort());
    for (const route of withBody) {
      expect((route.schema!.body as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it.each(Object.entries(VALID_BODIES))('%s answers 400 to an unknown field before any database work', async (name, body) => {
    dbHook.mockClear();
    const res = await app.inject({ method: 'POST', url: name.split(' ')[1], payload: { ...body, role: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'body must NOT have additional properties' });
    expect(dbHook).not.toHaveBeenCalled();
  });

  it('admin grant and deduct need a positive integer userId', async () => {
    dbHook.mockClear();
    for (const url of ['/credits/admin/grant', '/credits/admin/deduct']) {
      const post = (payload: object) => app.inject({ method: 'POST', url, payload });
      expect((await post({ amount: 5, description: 'abc' })).json()).toEqual({ message: "body must have required property 'userId'" });
      expect((await post({ userId: 0, amount: 5, description: 'abc' })).json()).toEqual({ message: 'body/userId must be >= 1' });
      expect((await post({ userId: 1.5, amount: 5, description: 'abc' })).json()).toEqual({ message: 'body/userId must be integer' });
    }
    expect(dbHook).not.toHaveBeenCalled();
  });
});

describe('what the web sends is still accepted', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(() => app.close());

  it('login, signup and the authenticated bodies pass validation', async () => {
    findByEmail.mockResolvedValue(null);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'abcdef1' } });
    expect(login.statusCode).toBe(401);

    findByEmail.mockResolvedValue({ id: 1, email: 'a@example.com' });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'a@example.com', password: 'abcdef1', referralCode: 'a3f8c21b' } });
    expect(signup.statusCode).toBe(409);

    for (const [url, payload] of [
      ['/credits/redeem', { code: 'WELCOME' }],
      ['/credits/claim/github', { action: 'star', repo: 'web' }],
      ['/video', { videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }],
    ] as const) {
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    }
  });

  it('query strings stay open', async () => {
    expect((await app.inject({ method: 'GET', url: '/video?limit=5&zzz=1' })).statusCode).toBe(401);
  });

  it('admin grant with a valid body reaches the handler, which refuses without the hash', async () => {
    const res = await app.inject({ method: 'POST', url: '/credits/admin/grant', payload: { userId: 1, amount: 5, description: 'abc' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('docs and root', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(() => app.close());

  it('the root is a two-field banner and Swagger lives under /docs', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('application/json');
    expect(root.json()).toEqual({ name: 'SummaryVideos API', docs: '/docs' });

    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect((await app.inject({ method: 'GET', url: '/json' })).statusCode).toBe(404);
  });

  it('the OpenAPI document lists no operational route and names the real servers', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    const paths = Object.keys(doc.paths);
    expect(paths.filter((p) => /admin|\/internal\/cron/.test(p))).toEqual([]);
    expect(paths).not.toContain('/');
    expect(doc.servers[0].url).toBe('https://api.summaryvideos.com');
    expect(JSON.stringify(doc.servers)).not.toContain('example.com');
  });

  it('hidden routes still exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/cron/expire-promos' })).statusCode).not.toBe(404);
  });
});
