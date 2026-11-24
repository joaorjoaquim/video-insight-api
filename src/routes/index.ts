import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import healthcheckRoutes from './healthcheck.routes';
import { userRoutes } from './user.routes';
import { videoRoutes } from './video.routes';
import { creditRoutes } from './credit.routes';
import { authRoutes } from './auth.routes';
import { cronRoutes } from './cron.routes';

export default async function routes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    { schema: { hide: true, response: { 200: Type.Object({ name: Type.String(), docs: Type.String() }) } } },
    async () => ({ name: 'SummaryVideos API', docs: '/docs' })
  );
  fastify.register(healthcheckRoutes, { prefix: '/healthcheck' });
  fastify.register(authRoutes, { prefix: '/auth' });
  fastify.register(userRoutes, { prefix: '/user' });
  fastify.register(videoRoutes, { prefix: '/video' });
  fastify.register(creditRoutes, { prefix: '/credits' });
  fastify.register(cronRoutes, { prefix: '/internal/cron' });
}
