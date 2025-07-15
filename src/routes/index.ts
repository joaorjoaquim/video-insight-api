import { FastifyInstance } from 'fastify';
import healthcheckRoutes from './healthcheck.routes';
import { userRoutes } from './user.routes';
import { videoRoutes } from './video.routes';
import { creditRoutes } from './credit.routes';
import { authRoutes } from './auth.routes';

export default async function routes(fastify: FastifyInstance) {
  fastify.register(healthcheckRoutes, { prefix: '/healthcheck' });
  fastify.register(authRoutes, { prefix: '/auth' });
  fastify.register(userRoutes, { prefix: '/user' });
  fastify.register(videoRoutes, { prefix: '/video' });
  fastify.register(creditRoutes, { prefix: '/credits' });
}
