import { FastifyRequest, FastifyReply } from 'fastify';
import {
  getUserByEmail,
  validatePassword,
  createUser,
  createOrUpdateOAuthUser,
} from '../services/user.service';
import { OAuthService, OAuthProvider } from '../services/oauth.service';

export async function signupController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { email, password } = request.body as {
    email: string;
    password: string;
  };

  try {
    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return reply.status(409).send({ message: 'User already exists' });
    }

    // Extract name from email (before @)
    const name = email.split('@')[0];

    const user = await createUser({ email, password, name });

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15d' }
    );

    return reply.status(201).send({
      user,
      token,
    });
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
    if (!['google', 'discord'].includes(provider)) {
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

  console.log('OAuth Callback received:');
  console.log('Provider:', provider);
  console.log('Code exists:', !!code);
  console.log('Query params:', request.query);

  try {
    if (!['google', 'discord'].includes(provider)) {
      console.log('Unsupported provider:', provider);
      return reply.status(400).send({ message: 'Unsupported provider' });
    }

    if (!code) {
      console.log('No authorization code provided');
      return reply.status(400).send({ message: 'Authorization code required' });
    }

    console.log('Processing OAuth callback for provider:', provider);

    // Handle OAuth callback
    const userProfile = await OAuthService.handleOAuthCallback(
      provider as OAuthProvider,
      code
    );

    console.log('User profile received:', {
      email: userProfile.email,
      name: userProfile.name,
      providerId: userProfile.providerId
    });

    // Create or update user
    const user = await createOrUpdateOAuthUser(
      provider,
      userProfile.providerId,
      userProfile.email,
      userProfile.name,
      userProfile.avatarUrl
    );

    console.log('User created/updated:', user.id);

    // Generate JWT token
    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15d' }
    );

    console.log('JWT token generated');

    // Get frontend URL from environment or use default
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    console.log('Redirecting to frontend:', `${frontendUrl}/auth/callback?token=${token}&provider=${provider}`);
    
    // Redirect to frontend with token
    return reply.redirect(`${frontendUrl}/auth/callback?token=${token}&provider=${provider}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    request.log.error(error);
    
    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return reply.redirect(`${frontendUrl}/auth/callback?error=oauth_failed`);
  }
}
