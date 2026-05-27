import type { VideoPipelineContext } from '../../lib/video-types';
import { logVideoEvent } from '../../lib/log-video-event';
import type { TranscriptResult, TranscriptSegment } from './types';

const SUPADATA_BASE = 'https://api.supadata.ai/v1';

type SupadataMode = 'native' | 'auto' | 'generate';

interface SupadataSegment {
  text: string;
  offset?: number;   // milliseconds
  duration?: number; // milliseconds
}

interface SupadataTranscriptResponse {
  content?: string | SupadataSegment[];
  lang?: string;
  jobId?: string;
}

interface SupadataJobResponse {
  status: string;
  content?: string | SupadataSegment[];
  error?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function flattenContent(content: SupadataTranscriptResponse['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.map((c) => c.text).join(' ');
}

function extractSegments(content: SupadataTranscriptResponse['content']): TranscriptSegment[] | undefined {
  if (!content || typeof content === 'string') return undefined;
  const withOffset = content.filter((c) => c.offset !== undefined);
  if (!withOffset.length) return undefined;
  return withOffset.map((c) => ({
    time: formatTime((c.offset ?? 0) / 1000),
    text: c.text.trim(),
  }));
}

export async function supadataFetchTranscript(
  ctx: VideoPipelineContext,
  mode: SupadataMode = 'auto',
  jobId?: string | null
): Promise<TranscriptResult | { pending: true; jobId: string } | null> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    return null;
  }

  const start = Date.now();

  if (jobId) {
    const jobUrl = `${SUPADATA_BASE}/transcript/${encodeURIComponent(jobId)}`;
    const res = await fetch(jobUrl, {
      headers: { 'x-api-key': apiKey },
    });
    const data = (await res.json()) as SupadataJobResponse;

    await logVideoEvent({
      ctx,
      stage: 'poll',
      event: 'completed',
      msg: 'supadata_job_poll',
      provider: 'supadata',
      durationMs: Date.now() - start,
      httpStatus: res.status,
      outputSummary: { status: data.status, jobId },
    });

    if (data.status === 'completed' && data.content) {
      const text = flattenContent(data.content);
      if (text) {
        return {
          text,
          segments: extractSegments(data.content),
          provider: 'supadata',
          supadataJobId: jobId,
        };
      }
    }
    if (data.status === 'failed') {
      return null;
    }
    return { pending: true, jobId };
  }

  const params = new URLSearchParams({
    url: ctx.videoUrl,
    text: 'true',
    mode,
  });

  await logVideoEvent({
    ctx,
    stage: 'fallback',
    event: 'started',
    msg: 'supadata_transcript_request',
    provider: 'supadata',
    inputSummary: { mode, videoUrl: ctx.videoUrl },
  });

  const res = await fetch(`${SUPADATA_BASE}/transcript?${params}`, {
    headers: { 'x-api-key': apiKey },
  });

  if (res.status === 202) {
    const data = (await res.json()) as SupadataTranscriptResponse;
    if (data.jobId) {
      await logVideoEvent({
        ctx,
        stage: 'fallback',
        event: 'completed',
        msg: 'supadata_job_queued',
        provider: 'supadata',
        durationMs: Date.now() - start,
        outputSummary: { jobId: data.jobId },
      });
      return { pending: true, jobId: data.jobId };
    }
    return null;
  }

  if (!res.ok) {
    await logVideoEvent({
      ctx,
      stage: 'fallback',
      event: 'failed',
      msg: 'supadata_transcript_failed',
      provider: 'supadata',
      durationMs: Date.now() - start,
      httpStatus: res.status,
      errorCode: 'SUPADATA_FAILED',
    });
    return null;
  }

  const data = (await res.json()) as SupadataTranscriptResponse;
  const text = flattenContent(data.content);

  if (!text) {
    return null;
  }

  await logVideoEvent({
    ctx,
    stage: 'fallback',
    event: 'completed',
    msg: 'supadata_transcript_ok',
    provider: 'supadata',
    durationMs: Date.now() - start,
    outputSummary: { textLength: text.length, mode },
  });

  return {
    text,
    segments: extractSegments(data.content),
    provider: 'supadata',
  };
}
