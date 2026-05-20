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
import { UserRepository } from '../repositories/user.repository';

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

    // Apply referral bonus silently — never fail signup over this
    if (referralCode) {
      try {
        const referrer = await findUserByReferralCode(referralCode);
        if (referrer && referrer.id !== user.id) {
          await UserRepository.update(user.id as number, { referredByCode: referralCode });
          await grantCreditsInternal(
            user.id as number,
            10,
            'Referral signup bonus',
            'referral_signup'
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

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15d' }
    );

    return reply.status(201).send({ user, token });
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

    // Check if user has password (OAuth users might not have passwords)
    if (!user.password) {
      return reply.status(401).send({ message: 'Please use OAuth to login' });
    }

    const isValid = await validatePassword(user, password);
    if (!isValid) {
      return reply.status(401).send({ message: 'Invalid email or password' });
    }

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15d' }
    );

    const { password: _, ...userWithoutPassword } = user;

    return reply.send({
      user: userWithoutPassword,
      token,
    });
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
  const { code } = request.query as { code: string };

  try {
    if (!['google', 'discord', 'github'].includes(provider)) {
      request.log.warn({ provider }, 'oauth_callback_unsupported_provider');
      return reply.status(400).send({ message: 'Unsupported provider' });
    }

    if (!code) {
      return reply.status(400).send({ message: 'Authorization code required' });
    }

    const userProfile = await OAuthService.handleOAuthCallback(provider as OAuthProvider, code);

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

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15d' }
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return reply.redirect(`${frontendUrl}/auth/callback?token=${token}&provider=${provider}`);
  } catch (error) {
    request.log.error({ error, provider }, 'oauth_callback_error');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return reply.redirect(`${frontendUrl}/auth/callback?error=oauth_failed`);
  }
}
