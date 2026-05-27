import type { VideoPipelineContext } from '../../lib/video-types';
import { logVideoEvent } from '../../lib/log-video-event';
import type { TranscriptResult, TranscriptSegment } from './types';

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      // Handle /shorts/ URLs
      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?#]+)/);
      if (shortsMatch) return shortsMatch[1];
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
    const raw = await YoutubeTranscript.fetchTranscript(videoId);

    const text = raw.map((s) => s.text).join(' ').trim();
    if (!text) return null;

    // Preserve real timestamps — offset is in seconds
    const segments: TranscriptSegment[] = raw
      .filter((s) => s.text?.trim())
      .map((s) => ({
        time: formatTime(s.offset),
        text: s.text.trim(),
      }));

    await logVideoEvent({
      ctx,
      stage: 'fallback',
      event: 'completed',
      msg: 'youtube_native_ok',
      provider: 'youtube_native',
      durationMs: Date.now() - start,
      outputSummary: { textLength: text.length, segmentCount: raw.length },
    });

    return {
      text,
      segments,
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
