import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import addFormats from 'ajv-formats';
import { errorHandler } from './plugins/errorHandler';
import routes from './routes';
import {
  initializeConnections,
  disconnectConnections,
  cacheService,
} from './config/redis.config';

export function buildServer() {
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  
  const app = Fastify({
    pluginTimeout: 60000,
    genReqId: (req) =>
      (req.headers['x-correlation-id'] as string) ||
      `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV !== 'production' && !isVercel
          ? { target: 'pino-pretty' }
          : undefined,
    },
    ajv: {
      customOptions: { removeAdditional: false },
      plugins: [
        addFormats,
        (ajv) => {
          ajv.addKeyword({
            keyword: 'example',
            metaSchema: {},
            validate: () => true,
          });
        },
      ],
    },
  });

  const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
  app.register(cors, {
    origin: allowedOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.register(cookie);
  app.register(helmet, { contentSecurityPolicy: false });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: process.env.RATE_LIMIT_REDIS_URL ? undefined : cacheService,
    skipOnError: true,
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    const ct = reply.getHeader('content-type') as string | undefined;
    if (ct && ct.startsWith('application/json') && !ct.includes('charset')) {
      reply.header('content-type', 'application/json; charset=utf-8');
    }
    done(null, payload);
  });

  app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'SummaryVideos API',
        description:
          'REST API behind summaryvideos.com: authentication, video submissions and their analysis, credits.',
        version: '1.0.0',
      },
      servers: [
        { url: 'https://api.summaryvideos.com', description: 'Production' },
        { url: 'http://localhost:5000', description: 'Local development' },
      ],
      tags: [
        {
          name: 'Health',
          description:
            'Endpoints to verify API health and database connectivity',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'full',
      deepLinking: false,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  let dbInitialized = false;
  let dbInitializing: Promise<void> | null = null;

  app.addHook('preHandler', async (_request: any, reply) => {
    if (_request.url === '/healthcheck' || _request.url?.startsWith('/healthcheck?')) return;
    if (dbInitialized) return;

    if (!dbInitializing) {
      dbInitializing = initializeConnections()
        .then(() => {
          dbInitialized = true;
          dbInitializing = null;
          app.log.info('db_connected');
        })
        .catch((err) => {
          dbInitializing = null;
          app.log.error({ err }, 'db_init_failed');
          throw err;
        });
    }

    try {
      await dbInitializing;
    } catch {
      reply.status(503).send({ error: 'Service temporarily unavailable', code: 'DB_UNAVAILABLE' });
    }
  });

  app.setErrorHandler(errorHandler);

  app.register(require('./plugins/auth').default);
  app.register(routes);

  return app;
}

export default buildServer();

process.on('SIGINT', async () => {
  await disconnectConnections();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectConnections();
  process.exit(0);
});
