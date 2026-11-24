import { FastifyRequest, FastifyReply } from 'fastify';
import { getUserById } from '../services/user.service';

interface AuthenticatedRequest extends FastifyRequest {
  user: {
    userId: number;
    email: string;
  };
}

export async function getProfileHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  try {
    const userId = request.user.userId;
    const user = await getUserById(userId);

    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    return reply.send(user);
  } catch (error) {
    request.log.error({ err: error }, 'profile_get_failed');
    return reply.status(500).send({ message: 'Failed to get profile' });
  }
}
