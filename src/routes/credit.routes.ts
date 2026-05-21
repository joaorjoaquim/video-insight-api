import { FastifyInstance } from 'fastify';
import {
  getUserCreditsHandler,
  grantCreditsHandler,
  deductCreditsHandler,
} from '../controllers/credit.controller';
import {
  redeemPromoCodeHandler,
  createPromoCodeHandler,
  listPromoCodesHandler,
} from '../controllers/promo.controller';
import { claimGitHubCreditsHandler } from '../controllers/github-claim.controller';
import {
  GetCreditsResponseSchema,
  AdminCreditRequestSchema,
  AdminCreditResponseSchema,
  ErrorResponseSchema,
} from '../schemas/credit.schema';
import { Type } from '@sinclair/typebox';

export async function creditRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ description: 'Number of transactions per page', example: 20 })),
          cursor: Type.Optional(Type.String({ description: 'Pagination cursor from previous response (createdAt|id format)', example: '2026-01-15T10:30:00.000Z|42' })),
        }),
        response: {
          200: GetCreditsResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    getUserCreditsHandler
  );

  // Redeem promo code
  fastify.post(
    '/redeem',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (request) => `redeem:${(request.user as any)?.userId ?? request.ip}`,
        },
      },
      schema: {
        body: Type.Object({
          code: Type.String({ minLength: 1, maxLength: 50 }),
        }),
        response: {
          200: Type.Object({
            credits: Type.Number(),
            coinsAdded: Type.Number(),
            message: Type.String(),
          }),
          400: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    redeemPromoCodeHandler
  );

  // Claim GitHub star/fork credits
  fastify.post(
    '/claim/github',
    {
      schema: {
        body: Type.Object({
          action: Type.Union([Type.Literal('star'), Type.Literal('fork')]),
          repo: Type.Optional(Type.Union([Type.Literal('web'), Type.Literal('api')])),
        }),
        response: {
          200: Type.Object({
            credits: Type.Number(),
            coinsAdded: Type.Number(),
            message: Type.String(),
          }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          429: ErrorResponseSchema,
          500: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    claimGitHubCreditsHandler
  );

  // Admin routes — strict rate limit: 10 req per 15 min per IP
  const adminRateLimit = { max: 10, timeWindow: '15 minutes' };

  fastify.post(
    '/admin/grant',
    {
      config: { rateLimit: adminRateLimit },
      schema: {
        body: AdminCreditRequestSchema,
        response: {
          200: AdminCreditResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    grantCreditsHandler
  );

  fastify.post(
    '/admin/deduct',
    {
      config: { rateLimit: adminRateLimit },
      schema: {
        body: AdminCreditRequestSchema,
        response: {
          200: AdminCreditResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    deductCreditsHandler
  );

  // Admin promo code routes
  fastify.post(
    '/admin/promo',
    {
      config: { rateLimit: adminRateLimit },
      schema: {
        body: Type.Object({
          code: Type.String({ minLength: 1, maxLength: 50 }),
          credits: Type.Number({ minimum: 1 }),
          maxUses: Type.Optional(Type.Number({ minimum: 1 })),
          expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
          description: Type.Optional(Type.String({ maxLength: 500 })),
        }),
        response: {
          201: Type.Object({ promoCode: Type.Any() }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    createPromoCodeHandler
  );

  fastify.get(
    '/admin/promos',
    {
      config: { rateLimit: adminRateLimit },
      schema: {
        response: {
          200: Type.Object({
            promoCodes: Type.Array(Type.Any()),
            total: Type.Number(),
          }),
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    listPromoCodesHandler
  );
}
