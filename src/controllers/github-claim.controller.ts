import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../repositories/user.repository';
import { verifyGitHubAction, getCreditsForAction, getClaimFlag, GitHubAction, GitHubRepo } from '../services/github.service';
import { grantCreditsInternal } from '../services/credit.service';
import { cacheService } from '../config/redis.config';

interface ClaimGitHubBody {
  githubUsername?: string;
  action: GitHubAction;
  repo?: GitHubRepo;
}

const RATE_LIMIT_WINDOW_SECONDS = 60;

export async function claimGitHubCreditsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = (request.user as any)?.userId as number;
  const { githubUsername, action, repo: repoInput } = request.body as ClaimGitHubBody;
  const repo: GitHubRepo = repoInput ?? 'web';

  if (!['star', 'fork'].includes(action)) {
    return reply.status(400).send({ message: 'Invalid action. Must be "star" or "fork"' });
  }

  // Per-user rate limit: 1 req/min on this endpoint
  const rateLimitKey = `github_claim_rl:${userId}`;
  try {
    if (cacheService) {
      const existing = await cacheService.get(rateLimitKey);
      if (existing) {
        return reply.status(429).send({ message: 'Too many requests. Wait 1 minute before trying again.' });
      }
      await cacheService.set(rateLimitKey, '1', RATE_LIMIT_WINDOW_SECONDS);
    }
  } catch {
    // Redis unavailable — proceed without rate limit rather than blocking the user
    request.log.warn({ userId }, 'github_claim_rate_limit_redis_unavailable');
  }

  const user = await UserRepository.findOne({ where: { id: userId } });
  if (!user) {
    return reply.status(404).send({ message: 'User not found' });
  }

  const claimFlag = getClaimFlag(action, repo);

  if (user[claimFlag]) {
    return reply.status(409).send({
      message: `You have already claimed credits for ${action}ing the ${repo} repository`,
    });
  }

  const usernameToCheck = user.githubUsername || githubUsername;
  if (!usernameToCheck) {
    return reply.status(400).send({
      message: 'GitHub username required. Provide it in the request body or connect GitHub via OAuth.',
    });
  }

  request.log.info({ userId, githubUsername: usernameToCheck, action, repo }, 'github_claim_verify_start');

  let verified: boolean;
  try {
    verified = await verifyGitHubAction(usernameToCheck, action, repo);
  } catch (err) {
    request.log.error({ err, userId }, 'github_claim_verify_error');
    return reply.status(502).send({ message: 'Failed to verify GitHub activity. Try again later.' });
  }

  if (!verified) {
    return reply.status(404).send({
      message: `GitHub username "${usernameToCheck}" has not ${action}ed the ${repo} repository`,
    });
  }

  const creditsToGrant = getCreditsForAction(action);
  const repoLabel = repo === 'web' ? 'video-insight-web' : 'video-insight-api';

  // Store username if not already stored
  const updates: Partial<typeof user> = { [claimFlag]: true };
  if (!user.githubUsername && githubUsername) {
    updates.githubUsername = githubUsername;
  }

  await UserRepository.update(userId, updates);

  await grantCreditsInternal(
    userId,
    creditsToGrant,
    `GitHub ${action} reward — ${repoLabel}`,
    'github_claim',
    `${action}:${repo}`
  );

  const updated = await UserRepository.findOne({ where: { id: userId } });

  request.log.info({ userId, action, repo, creditsToGrant }, 'github_claim_success');

  return reply.send({
    credits: updated?.credits ?? 0,
    coinsAdded: creditsToGrant,
    message: `Claimed ${creditsToGrant} credits for ${action}ing ${repoLabel}!`,
  });
}
