import { FastifyRequest, FastifyReply } from 'fastify';
import {
  getUserByEmail,
  validatePassword,
  createUser,
  createOrUpdateOAuthUser,
  findUserByReferralCode,
} from '../services/user.service';
import { OAuthService, OAuthProvider } from '../services/oauth.service';
import { grantCreditsInternal } from '../services/credit.service';
import { TransactionType } from '../entities/CreditTransaction';
import { UserRepository } from '../repositories/user.repository';
import {
  issueRefreshToken,
  setRefreshCookie,
} from '../services/auth.service';

export async function signupController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { email, password, referralCode } = request.body as {
    email: string;
    password: string;
    referralCode?: string;
  };

  try {
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return reply.status(409).send({ message: 'User already exists' });
    }

    const name = email.split('@')[0];
    const user = await createUser({ email, password, name });

    if (referralCode) {
      try {
        const referrer = await findUserByReferralCode(referralCode);
        if (referrer && referrer.id !== user.id) {
          await UserRepository.update(user.id as number, { referredByCode: referralCode });
          await grantCreditsInternal(
            user.id as number,
            10,
            'Referral signup bonus',
            'referral_signup',
            undefined,
            TransactionType.REFERRAL_REWARD
          );
          request.log.info(
            { userId: user.id, referredByCode: referralCode },
            'referral_signup_bonus_granted'
          );
        }
      } catch (refErr) {
        request.log.warn({ refErr, referralCode }, 'referral_signup_bonus_failed_silently');
      }
    }

    const accessToken = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15m' }
    );

    const refreshToken = await issueRefreshToken(user.id as number);
    setRefreshCookie(reply, refreshToken);

    return reply.status(201).send({ user, accessToken });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Internal server error' });
  }
}

export async function loginController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { email, password } = request.body as {
    email: string;
    password: string;
  };

  try {
    const user = await getUserByEmail(email);

    if (!user) {
      return reply.status(401).send({ message: 'Invalid email or password' });
    }

    if (!user.password) {
      return reply.status(401).send({ message: 'Please use OAuth to login' });
    }

    const isValid = await validatePassword(user, password);
    if (!isValid) {
      return reply.status(401).send({ message: 'Invalid email or password' });
    }

    const accessToken = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15m' }
    );

    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(reply, refreshToken);

    const { password: _, ...userWithoutPassword } = user;
    return reply.send({ user: userWithoutPassword, accessToken });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Internal server error' });
  }
}

export async function oauthRedirectController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { provider } = request.params as { provider: string };

  try {
    if (!['google', 'discord', 'github'].includes(provider)) {
      return reply.status(400).send({ message: 'Unsupported provider' });
    }

    const oauthUrl = OAuthService.getOAuthUrl(provider as OAuthProvider);
    return reply.redirect(oauthUrl);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'OAuth configuration error' });
  }
}

export async function oauthCallbackController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { provider } = request.params as { provider: string };
  const { code, state } = request.query as { code: string; state?: string };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    if (!['google', 'discord', 'github'].includes(provider)) {
      request.log.warn({ provider }, 'oauth_callback_unsupported_provider');
      return reply.status(400).send({ message: 'Unsupported provider' });
    }

    if (!code) {
      return reply.status(400).send({ message: 'Authorization code required' });
    }

    const userProfile = await OAuthService.handleOAuthCallback(provider as OAuthProvider, code);

    const linkState = state ? OAuthService.decodeLinkState(state) : null;
    if (linkState && provider === 'github') {
      try {
        const existingUser = await UserRepository.findOne({ where: { id: linkState.userId } });
        if (!existingUser) {
          return reply.redirect(`${frontendUrl}/auth/callback?error=link_user_not_found`);
        }
        if (existingUser.githubId && userProfile.githubId && existingUser.githubId !== userProfile.githubId) {
          return reply.redirect(`${frontendUrl}/wallet?error=github_already_linked`);
        }
        if (userProfile.githubId) {
          const alreadyOwned = await UserRepository.findOne({ where: { githubId: userProfile.githubId } });
          if (alreadyOwned && alreadyOwned.id !== existingUser.id) {
            return reply.redirect(`${frontendUrl}/wallet?error=github_already_owned`);
          }
        }
        await UserRepository.update(existingUser.id, {
          githubUsername: userProfile.githubUsername || existingUser.githubUsername,
          githubId: userProfile.githubId || existingUser.githubId,
        });
        request.log.info({ userId: existingUser.id }, 'github_account_linked');
        return reply.redirect(`${frontendUrl}/wallet?github_linked=1`);
      } catch (linkErr) {
        request.log.error({ error: linkErr, userId: linkState.userId }, 'github_link_failed');
        return reply.redirect(`${frontendUrl}/wallet?error=link_failed`);
      }
    }

    const user = await createOrUpdateOAuthUser(
      provider,
      userProfile.providerId,
      userProfile.email,
      userProfile.name,
      userProfile.avatarUrl,
      userProfile.githubUsername,
      userProfile.githubId
    );

    request.log.info({ userId: user.id, provider }, 'oauth_callback_success');

    const accessToken = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15m' }
    );

    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(reply, refreshToken);

    return reply.redirect(
      `${frontendUrl}/auth/callback?access_token=${accessToken}&provider=${provider}`
    );
  } catch (error) {
    request.log.error({ error, provider }, 'oauth_callback_error');
    return reply.redirect(`${frontendUrl}/auth/callback?error=oauth_failed`);
  }
}

export async function linkGithubController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const userId = (request.user as any)?.userId as number;
  if (!userId) return reply.status(401).send({ message: 'Unauthorized' });

  const linkUrl = OAuthService.getLinkUrl('github', userId);
  return reply.send({ url: linkUrl });
}
