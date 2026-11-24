import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { VerifyOptions } from '@fastify/jwt';
import fp from 'fastify-plugin';
import { requireJwtSecret } from '../config/jwt-secret';

async function authPlugin(fastify: FastifyInstance, opts: FastifyPluginOptions) {
    fastify.register(require('@fastify/jwt'), {
        secret: requireJwtSecret()
    });

    fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await request.jwtVerify();
        } catch (err) {
            reply.status(401).send({ message: 'Token inválido ou ausente' });
        }
    });
}

export default fp(authPlugin);
