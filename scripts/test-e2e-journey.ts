/**
 * E2E journey: login → POST video → poll status → trace
 */
import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'e2e-test@video-insight.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'E2eTestPass123!';
const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const MAX_POLLS = parseInt(process.env.MAX_POLLS || '60', 10);

const URLS = [
  { id: 'YT-long', url: 'https://www.youtube.com/watch?v=i5FEDORWvuc' },
  { id: 'YT-short', url: 'https://www.youtube.com/shorts/S7HDg-1hkIk' },
  { id: 'IG-1', url: 'https://www.instagram.com/reels/DYYLU8hIXHT/' },
  { id: 'IG-2', url: 'https://www.instagram.com/reels/DYhkKcVR6BJ/' },
];

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function ensureAuth(): Promise<string> {
  let login = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  let body = await json(login);
  if (login.ok && body.token) return body.token;

  const reg = await fetch(`${API_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Test',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
  });
  body = await json(reg);
  if (reg.ok && body.token) return body.token;

  login = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  body = await json(login);
  if (login.ok && body.token) return body.token;

  throw new Error(`Auth failed: ${JSON.stringify(body)}`);
}

async function testUrl(token: string, test: { id: string; url: string }) {
  console.log(`\n${'='.repeat(60)}\n[${test.id}] ${test.url}\n${'='.repeat(60)}`);

  const createRes = await fetch(`${API_URL}/video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ videoUrl: test.url }),
  });
  const created = await json(createRes);
  console.log('POST /video', createRes.status, {
    id: created.id,
    correlationId: created.correlationId,
    status: created.status,
    message: created.message,
  });

  if (!createRes.ok) {
    return { id: test.id, ok: false, phase: 'create', body: created };
  }

  const videoId = created.id;
  const correlationId = created.correlationId;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const statusRes = await fetch(`${API_URL}/video/${videoId}/status`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
      },
    });
    const status = await json(statusRes);
    console.log(`Poll ${i + 1}/${MAX_POLLS}`, {
      http: statusRes.status,
      status: status.status,
      lastStage: status.lastStage,
      processingProvider: status.processingProvider,
      failureStage: status.failureStage,
      failureCode: status.failureCode,
      errorMessage: status.errorMessage,
      title: status.title?.slice?.(0, 50),
    });

    if (status.status === 'completed' || status.status === 'failed') {
      const traceRes = await fetch(`${API_URL}/video/${videoId}/trace`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const trace = await json(traceRes);
      const events = (trace.events || []) as Array<{
        stage: string;
        event: string;
        msg: string;
        provider?: string;
      }>;
      console.log('TRACE summary', {
        correlationId: trace.correlationId,
        eventCount: events.length,
        stages: [...new Set(events.map((e) => e.stage))],
        lastEvents: events.slice(-5).map((e) => `${e.stage}:${e.event}:${e.msg}`),
      });

      if (status.status === 'completed') {
        const detailRes = await fetch(`${API_URL}/video/${videoId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const detail = await json(detailRes);
        console.log('GET /video/:id', {
          hasSummary: !!detail.summary,
          hasInsights: !!detail.insights,
          transcriptSegments: detail.transcript?.length ?? 0,
          meta: detail.meta ?? detail.dashboard?.meta,
        });
      }

      return {
        id: test.id,
        ok: status.status === 'completed',
        finalStatus: status.status,
        correlationId,
        videoId,
        failureCode: status.failureCode,
        traceEvents: events.length,
      };
    }
  }

  return { id: test.id, ok: false, phase: 'timeout', videoId, correlationId };
}

async function main() {
  console.log('Healthcheck...');
  const hc = await fetch(`${API_URL}/healthcheck/healthcheck`);
  console.log('GET /healthcheck/healthcheck', hc.status, await json(hc));

  const token = await ensureAuth();
  console.log('Auth OK');

  const results = [];
  for (const u of URLS) {
    results.push(await testUrl(token, u));
  }

  console.log('\n\n=== SUMMARY ===');
  console.table(results);
  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
