import type { VideoPipelineContext } from '../../lib/video-types';
import { logVideoEvent } from '../../lib/log-video-event';
import type { TranscriptResult } from './types';

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

export async function youtubeNativeTranscript(
  ctx: VideoPipelineContext
): Promise<TranscriptResult | null> {
  const videoId = extractYouTubeVideoId(ctx.videoUrl);
  if (!videoId) {
    return null;
  }

  const start = Date.now();

  await logVideoEvent({
    ctx,
    stage: 'fallback',
    event: 'started',
    msg: 'youtube_native_request',
    provider: 'youtube_native',
    inputSummary: { videoId },
  });

  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map((s) => s.text).join(' ').trim();

    if (!text) {
      return null;
    }

    await logVideoEvent({
      ctx,
      stage: 'fallback',
      event: 'completed',
      msg: 'youtube_native_ok',
      provider: 'youtube_native',
      durationMs: Date.now() - start,
      outputSummary: { textLength: text.length, segmentCount: segments.length },
    });

    return {
      text,
      provider: 'youtube_native',
      externalVideoId: videoId,
      title: ctx.videoTitle ?? undefined,
    };
  } catch (error) {
    await logVideoEvent({
      ctx,
      stage: 'fallback',
      event: 'failed',
      msg: 'youtube_native_failed',
      provider: 'youtube_native',
      durationMs: Date.now() - start,
      errorCode: 'YOUTUBE_NATIVE_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
