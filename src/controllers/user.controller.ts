import { FastifyRequest, FastifyReply } from 'fastify';
import { createUser, getUserById } from '../services/user.service';

interface CreateUserRequest {
  Body: {
    name: string;
    email: string;
    password: string;
  };
}

interface GetUserRequest {
  Params: {
    id: string;
  };
}

interface AuthenticatedRequest extends FastifyRequest {
  user: {
    userId: number;
    email: string;
  };
}

export async function createUserHandler(
  request: FastifyRequest<CreateUserRequest>,
  reply: FastifyReply
) {
  try {
    const userData = request.body;
    const user = await createUser(userData);

    return reply.status(201).send(user);
  } catch (error) {
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Failed to create user',
    });
  }
}

export async function getUserHandler(
  request: FastifyRequest<GetUserRequest>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const user = await getUserById(parseInt(id));

    if (!user) {
      return reply.status(404).send({ message: 'User not found' });
    }

    return reply.send(user);
  } catch (error) {
    return reply.status(500).send({
      message: error instanceof Error ? error.message : 'Failed to get user',
    });
  }
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
    return reply.status(500).send({
      message: error instanceof Error ? error.message : 'Failed to get profile',
    });
  }
}
