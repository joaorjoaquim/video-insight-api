import { FastifyRequest, FastifyReply } from 'fastify';
import { createPromoCode, listPromoCodes, redeemPromoCode } from '../services/promo.service';
import { secureCompare } from '../lib/secure-compare';

interface RedeemBody {
  code: string;
}

interface CreatePromoBody {
  code: string;
  credits: number;
  maxUses?: number;
  expiresAt?: string;
  description?: string;
}

function verifyAdminHash(request: FastifyRequest, reply: FastifyReply): boolean {
  const provided = request.headers['x-admin-hash'] as string | undefined;
  const expected = process.env.ADMIN_CREDIT_HASH;

  if (!expected || !secureCompare(provided, expected)) {
    request.log.warn({ ip: request.ip }, 'admin_hash_unauthorized_attempt');
    reply.status(401).send({ message: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function redeemPromoCodeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = (request.user as any)?.userId as number;
  const { code } = request.body as RedeemBody;

  if (!code || typeof code !== 'string') {
    return reply.status(400).send({ message: 'Promo code is required' });
  }

  try {
    const result = await redeemPromoCode(userId, code);
    return reply.status(result.statusCode).send(
      result.success
        ? { credits: result.credits, coinsAdded: result.coinsAdded, message: result.message }
        : { message: result.message }
    );
  } catch (err) {
    request.log.error({ err, userId }, 'promo_redeem_handler_error');
    return reply.status(500).send({ message: 'Failed to redeem promo code' });
  }
}

export async function createPromoCodeHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!verifyAdminHash(request, reply)) return;

  const body = request.body as CreatePromoBody;

  if (!body.code || !body.credits || body.credits < 1) {
    return reply.status(400).send({ message: 'code and credits (min 1) are required' });
  }

  request.log.info(
    { code: body.code, credits: body.credits, maxUses: body.maxUses },
    'admin_promo_create_attempt'
  );

  try {
    const promo = await createPromoCode({
      code: body.code,
      credits: body.credits,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      description: body.description ?? null,
    });

    return reply.status(201).send({ promoCode: promo });
  } catch (err: any) {
    if (err.statusCode === 409) {
      return reply.status(409).send({ message: err.message });
    }
    request.log.error({ err }, 'admin_promo_create_error');
    return reply.status(500).send({ message: 'Failed to create promo code' });
  }
}

export async function listPromoCodesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!verifyAdminHash(request, reply)) return;

  try {
    const result = await listPromoCodes();
    return reply.send(result);
  } catch (err) {
    request.log.error({ err }, 'admin_promo_list_error');
    return reply.status(500).send({ message: 'Failed to list promo codes' });
  }
}
