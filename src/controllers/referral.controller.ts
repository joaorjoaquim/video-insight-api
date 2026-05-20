import { FastifyRequest, FastifyReply } from 'fastify';
import {
  ensureReferralCode,
  countReferrals,
  getUserById,
} from '../services/user.service';

const REFERRAL_BASE_URL = process.env.FRONTEND_URL || 'https://summaryvideos.com';

export async function getReferralInfoHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = (request.user as any)?.userId as number;

  try {
    const referralCode = await ensureReferralCode(userId);
    const user = await getUserById(userId);

    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    const referralsCount = await countReferrals(referralCode);

    return reply.send({
      referralCode,
      referralUrl: `${REFERRAL_BASE_URL}/?ref=${referralCode}`,
      referralsCount,
      creditsEarned: (user as any).referralCreditsEarned ?? 0,
    });
  } catch (err) {
    request.log.error({ err, userId }, 'get_referral_info_error');
    return reply.status(500).send({ message: 'Failed to get referral info' });
  }
}
