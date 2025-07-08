import { FastifyInstance } from 'fastify';
import { loginController } from '../controllers/auth.controller';
import {
  LoginUserBodySchema,
  LoginResponseSchema,
  ErrorResponseSchema,
} from '../schemas/user.schema';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login',
    {
      schema: {
        body: LoginUserBodySchema,
        response: {
          200: LoginResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    loginController
  );
}
