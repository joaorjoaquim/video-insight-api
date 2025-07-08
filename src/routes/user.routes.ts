import { FastifyInstance } from 'fastify';
import {
  createUserHandler,
  getUserHandler,
} from '../controllers/user.controller';
import {
  CreateUserBodySchema,
  GetUserParamsSchema,
  UserResponseSchema,
  ErrorResponseSchema,
} from '../schemas/user.schema';

export async function userRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/register',
    {
      schema: {
        body: CreateUserBodySchema,
        response: {
          201: UserResponseSchema,
          400: ErrorResponseSchema,
        },
      },
    },
    createUserHandler
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: GetUserParamsSchema,
        response: {
          200: UserResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    getUserHandler
  );
}
