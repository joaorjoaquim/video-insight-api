import { FastifyInstance } from 'fastify';
import {
  getUserCreditsHandler,
  grantCreditsHandler,
  deductCreditsHandler,
} from '../controllers/credit.controller';
import {
  GetCreditsResponseSchema,
  AdminCreditRequestSchema,
  AdminCreditResponseSchema,
  ErrorResponseSchema,
} from '../schemas/credit.schema';
import { Type } from '@sinclair/typebox';

export async function creditRoutes(fastify: FastifyInstance) {
  // User credit routes (require authentication)
  fastify.get(
    '/',
    {
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(
            Type.Number({ description: 'Number of transactions to return' })
          ),
          offset: Type.Optional(
            Type.Number({ description: 'Number of transactions to skip' })
          ),
        }),
        response: {
          200: GetCreditsResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    getUserCreditsHandler
  );

  // Admin routes (no authentication required, but admin hash required)
  fastify.post(
    '/admin/grant',
    {
      schema: {
        body: AdminCreditRequestSchema,
        response: {
          200: AdminCreditResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    grantCreditsHandler
  );

  fastify.post(
    '/admin/deduct',
    {
      schema: {
        body: AdminCreditRequestSchema,
        response: {
          200: AdminCreditResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    deductCreditsHandler
  );
} 