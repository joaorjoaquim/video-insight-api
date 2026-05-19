import { randomUUID } from 'crypto';

export function generateCorrelationId(): string {
  return `vid_${randomUUID()}`;
}
