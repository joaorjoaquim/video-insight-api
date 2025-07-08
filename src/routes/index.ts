import { FastifyInstance } from 'fastify';
import healthcheckRoutes from './healthcheck.routes';
import { userRoutes } from './user.routes';
import { videoRoutes } from './video.routes';
import { authRoutes } from './auth.routes';

export default async function routes(fastify: FastifyInstance) {
  fastify.register(healthcheckRoutes);
  fastify.register(userRoutes, { prefix: '/user' });
  fastify.register(videoRoutes, { prefix: '/video' });
  fastify.register(authRoutes, { prefix: '/auth' });
}
