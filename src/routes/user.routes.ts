import { FastifyInstance } from 'fastify';
import {
  createUserHandler,
  getUserHandler,
  getProfileHandler,
} from '../controllers/user.controller';
import { getReferralInfoHandler } from '../controllers/referral.controller';
import {
  CreateUserBodySchema,
  GetUserParamsSchema,
  UserResponseSchema,
  ErrorResponseSchema,
} from '../schemas/user.schema';
import { Type } from '@sinclair/typebox';

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/referral',
    {
      schema: {
        response: {
          200: Type.Object({
            referralCode: Type.String(),
            referralUrl: Type.String(),
            referralsCount: Type.Number(),
            creditsEarned: Type.Number(),
          }),
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    getReferralInfoHandler
  );

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

  // Rota para buscar perfil do usuário autenticado
  fastify.get(
    '/profile',
    {
      schema: {
        response: {
          200: UserResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    getProfileHandler
  );
}
