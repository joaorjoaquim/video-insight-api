import { FastifyRequest, FastifyReply } from 'fastify';
import { WriteDataSource } from '../config/db.config';

export async function healthcheckController(request: FastifyRequest, reply: FastifyReply) {
  const initialized = WriteDataSource.isInitialized;
  let latency_ms: number | null = null;
  let queryFailed = false;

  if (initialized) {
    const start = Date.now();
    try {
      await WriteDataSource.query('SELECT 1');
      latency_ms = Date.now() - start;
    } catch (err) {
      queryFailed = true;
      request.log.error({ err }, 'healthcheck_db_query_failed');
    }
  }

  const status = !initialized || queryFailed
    ? 'down'
    : latency_ms! > 2000
      ? 'degraded'
      : 'ok';

  reply.status(status === 'down' ? 503 : 200).send({
    status,
    db: { initialized, latency_ms },
  });
}
