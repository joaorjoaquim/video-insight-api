/**
 * Manual pipeline validation — requires running API + credentials in .env
 *
 * Usage:
 *   API_URL=http://localhost:5000 JWT_TOKEN=ey... TEST_VIDEO_URL=https://youtube.com/... npx tsx scripts/validate-pipeline.ts
 */
import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:5000';
const JWT_TOKEN = process.env.JWT_TOKEN;
const TEST_VIDEO_URL =
  process.env.TEST_VIDEO_URL ||
  'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const MAX_POLLS = parseInt(process.env.MAX_TRANSCRIPTION_POLLS || '120', 10);

async function api(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JWT_TOKEN}`,
      ...(options.headers as Record<string, string>),
    },
  });
}

async function main() {
  if (!JWT_TOKEN) {
    console.error('Set JWT_TOKEN (login via POST /auth/login)');
    process.exit(1);
  }

  console.log('Creating video...', TEST_VIDEO_URL);
  const createRes = await api('/video', {
    method: 'POST',
    body: JSON.stringify({ videoUrl: TEST_VIDEO_URL }),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    console.error('Create failed', created);
    process.exit(1);
  }

  const videoId = created.id;
  const correlationId = created.correlationId;
  console.log('Created', { videoId, correlationId, status: created.status });

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusRes = await api(`/video/${videoId}/status`, {
      headers: correlationId
        ? { 'x-correlation-id': correlationId }
        : {},
    });
    const statusBody = await statusRes.json();
    console.log(`Poll ${i + 1}`, {
      status: statusBody.status,
      lastStage: statusBody.lastStage,
      processingProvider: statusBody.processingProvider,
      failureCode: statusBody.failureCode,
    });

    if (statusBody.status === 'completed' || statusBody.status === 'failed') {
      const traceRes = await api(`/video/${videoId}/trace`);
      const trace = await traceRes.json();
      console.log('Final', {
        status: statusBody.status,
        correlationId: statusBody.correlationId,
        traceEvents: trace.events?.length ?? 0,
        errorMessage: statusBody.errorMessage,
      });
      process.exit(statusBody.status === 'completed' ? 0 : 1);
    }
  }

  console.error('Timed out waiting for completion');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
