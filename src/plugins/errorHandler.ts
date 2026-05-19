import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import logger from '../config/logger';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  logger.error(
    {
      err: error,
      method: request.method,
      url: request.url,
      requestId: request.id,
    },
    'unhandled_request_error'
  );

  const statusCode =
    error.statusCode && error.statusCode < 500 ? error.statusCode : 500;

  reply.status(statusCode).send({
    message:
      statusCode >= 500
        ? 'An internal server error occurred'
        : error.message,
  });
}
