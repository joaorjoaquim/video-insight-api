import { Type } from '@sinclair/typebox';

export const HealthcheckResponseSchema = Type.Object({
  status: Type.String({ description: 'ok | degraded | down', example: 'ok' }),
  db: Type.Object({
    initialized: Type.Boolean(),
    latency_ms: Type.Union([Type.Number(), Type.Null()]),
  }),
  message: Type.Optional(Type.String()),
});
