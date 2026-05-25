import { FastifyRequest, FastifyReply } from 'fastify';
import { rotateRefreshToken, revokeRefreshToken, setRefreshCookie, clearRefreshCookie } from '../services/auth.service';
import { UserRepository } from '../repositories/user.repository';

export async function refreshController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const incomingToken = request.cookies?.refresh_token;

  if (!incomingToken) {
    return reply.status(401).send({ message: 'No refresh token' });
  }

  try {
    const result = await rotateRefreshToken(incomingToken);

    if (!result) {
      clearRefreshCookie(reply);
      return reply.status(401).send({ message: 'Invalid or expired refresh token' });
    }

    const user = await UserRepository.findOne({ where: { id: result.userId } });
    if (!user) {
      clearRefreshCookie(reply);
      return reply.status(401).send({ message: 'User not found' });
    }

    const accessToken = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '15m' }
    );

    setRefreshCookie(reply, result.newToken);

    const { password: _, ...userWithoutPassword } = user as any;
    return reply.send({ user: userWithoutPassword, accessToken });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Internal server error' });
  }
}

export async function logoutController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const incomingToken = request.cookies?.refresh_token;

  if (incomingToken) {
    try {
      await revokeRefreshToken(incomingToken);
    } catch (error) {
      request.log.warn({ error }, 'logout_revoke_failed');
    }
  }

  clearRefreshCookie(reply);
  return reply.status(204).send();
}
