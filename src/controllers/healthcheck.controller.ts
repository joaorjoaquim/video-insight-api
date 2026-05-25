import { FastifyRequest, FastifyReply } from 'fastify';
import { WriteDataSource } from '../config/db.config';

export async function healthcheckController(_request: FastifyRequest, reply: FastifyReply) {
  const initialized = WriteDataSource.isInitialized;
  let latency_ms: number | null = null;
  let dbError: string | undefined;

  if (initialized) {
    const start = Date.now();
    try {
      await WriteDataSource.query('SELECT 1');
      latency_ms = Date.now() - start;
    } catch (err: any) {
      dbError = err?.message;
    }
  }

  const status = !initialized || dbError
    ? 'down'
    : latency_ms! > 2000
      ? 'degraded'
      : 'ok';

  reply.status(status === 'down' ? 503 : 200).send({
    status,
    db: { initialized, latency_ms },
    ...(dbError ? { message: dbError } : {}),
  });
}
