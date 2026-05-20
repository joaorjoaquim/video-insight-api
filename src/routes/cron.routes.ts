import { FastifyInstance } from 'fastify';
import { expirePromoCodesHandler, weeklyCreditRestoreHandler } from '../controllers/cron.controller';
import { Type } from '@sinclair/typebox';

const CronResponseSchema = Type.Object({
  ok: Type.Boolean(),
});

// 5 req per 5 min per IP — Vercel cron calls once per trigger; this blocks scanners
const cronRateLimit = { max: 5, timeWindow: '5 minutes' };

export async function cronRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/expire-promos',
    { config: { rateLimit: cronRateLimit }, schema: { response: { 200: CronResponseSchema } } },
    expirePromoCodesHandler
  );
  fastify.get(
    '/restore-credits',
    { config: { rateLimit: cronRateLimit }, schema: { response: { 200: CronResponseSchema } } },
    weeklyCreditRestoreHandler
  );
}
