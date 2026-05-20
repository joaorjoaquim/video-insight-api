import { FastifyRequest, FastifyReply } from 'fastify';
import { runExpirePromoCodes, runWeeklyCreditRestore } from '../services/cron.service';
import { secureCompare } from '../lib/secure-compare';

function verifyCronSecret(request: FastifyRequest, reply: FastifyReply): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    request.log.error('CRON_SECRET env var not set — cron endpoints are disabled');
    reply.status(503).send({ message: 'Cron not configured' });
    return false;
  }

  // Vercel sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers['authorization'] as string | undefined;
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!secureCompare(provided, secret)) {
    request.log.warn({ ip: request.ip }, 'cron_unauthorized_attempt');
    reply.status(401).send({ message: 'Unauthorized' });
    return false;
  }

  return true;
}

export async function expirePromoCodesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!verifyCronSecret(request, reply)) return;

  try {
    const result = await runExpirePromoCodes();
    return reply.send({ ok: true, ...result });
  } catch (err) {
    request.log.error({ err }, 'cron_expire_promos_handler_error');
    return reply.status(500).send({ message: 'Cron job failed' });
  }
}

export async function weeklyCreditRestoreHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!verifyCronSecret(request, reply)) return;

  try {
    const result = await runWeeklyCreditRestore();
    return reply.send({ ok: true, ...result });
  } catch (err) {
    request.log.error({ err }, 'cron_weekly_restore_handler_error');
    return reply.status(500).send({ message: 'Cron job failed' });
  }
}
