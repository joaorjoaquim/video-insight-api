import { FastifyRequest, FastifyReply } from 'fastify';
import { getUserByEmail, validatePassword } from '../services/user.service';

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

    const isValid = await validatePassword(user, password);
    if (!isValid) {
      return reply.status(401).send({ message: 'Invalid email or password' });
    }

    const token = await reply.jwtSign(
      { userId: user.id, email: user.email },
      { expiresIn: '12h' }
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
