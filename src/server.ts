import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
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

  app.register(cors, {});
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
        title:
          'Video Insight API Documentation — Transcription, Summarization and Key Insights from Video URLs',
        description: `
            This API powers the backend for the Video Insight platform.

            It provides the following endpoints:

            Healthcheck: Verifies API health and database connectivity (/healthcheck)

            Authentication: Authenticates users and provides JWT tokens (/auth/login)

            Transcription: Transcribes video content from supported URLs (/transcribe)

            Summarization: Generates a general summary and extracts key insights from videos (/summarize)

            Storage: Retrieves and manages processed video summaries (/videos)

            Built with Fastify, TypeORM, PostgreSQL, and secured with JWT authentication.
        `,
        version: '1.0.0',
        contact: {
          name: 'Support team',
          email: 'support@example.com',
        },
      },
      servers: [
        {
          url: 'http://localhost:5000',
          description: 'Development Server',
        },
        {
          url: 'https://api.example.com',
          description: 'Production Server',
        },
      ],
      tags: [
        {
          name: 'Health',
          description:
            'Endpoints to verify API health and database connectivity',
        },
        {
          name: 'Authentication',
          description: 'Endpoints related to user authentication',
        },
        {
          name: 'Transcription',
          description: 'Endpoints to transcribe video content',
        },
        {
          name: 'Summarization',
          description: 'Endpoints to summarize video content',
        },
        {
          name: 'Storage',
          description: 'Endpoints to store and manage video summaries',
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
      externalDocs: {
        url: 'https://swagger.io',
        description: 'Find more information here',
      },
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/',
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
