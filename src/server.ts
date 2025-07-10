import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
    logger: {
      level: 'info',
      transport:
        process.env.NODE_ENV !== 'production' && !isVercel
          ? { target: 'pino-pretty' }
          : undefined,
    },
    ajv: {
      plugins: [
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

  app.addHook('onReady', async () => {
    await initializeConnections();
    app.log.info('Database and cache services connected via onReady hook');
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
