import type { VideoPipelineContext } from '../../lib/video-types';
import { logVideoEvent } from '../../lib/log-video-event';
import { failVideo } from '../../lib/fail-video';
import type { TranscriptResult } from './types';
import { supadataFetchTranscript } from './supadata.provider';
import { youtubeNativeTranscript, isYouTubeUrl } from './youtube-native.provider';

export * from './videodowncut.provider';
export * from './supadata.provider';
export * from './youtube-native.provider';
export type { TranscriptResult } from './types';

/**
 * Fallback chain when VideoDownCut download/transcribe fails.
 * Order: Supadata auto → YouTube native (YT only) → Supadata generate
 */
export async function fetchTranscriptWithFallback(
  ctx: VideoPipelineContext,
  existingJobId?: string | null
): Promise<TranscriptResult | { pending: true; jobId: string } | null> {
  if (existingJobId) {
    const jobResult = await supadataFetchTranscript(ctx, 'auto', existingJobId);
    if (jobResult && 'pending' in jobResult) return jobResult;
    if (jobResult && 'text' in jobResult) return jobResult;
  }

  const modes: Array<'auto' | 'native' | 'generate'> = ['auto', 'native', 'generate'];

  for (const mode of modes) {
    if (mode === 'native' && !isYouTubeUrl(ctx.videoUrl)) {
      continue;
    }

    if (mode === 'native' && isYouTubeUrl(ctx.videoUrl)) {
      const yt = await youtubeNativeTranscript(ctx);
      if (yt) return yt;
      continue;
    }

    const result = await supadataFetchTranscript(ctx, mode);
    if (result && 'pending' in result) {
      return result;
    }
    if (result && 'text' in result && result.text) {
      return result;
    }

    await logVideoEvent({
      ctx,
      stage: 'fallback',
      event: 'retry',
      msg: `fallback_try_next_mode`,
      provider: 'supadata',
      outputSummary: { triedMode: mode },
    });
  }

  if (isYouTubeUrl(ctx.videoUrl)) {
    const yt = await youtubeNativeTranscript(ctx);
    if (yt) return yt;
  }

  return null;
}

export async function failTranscriptExhausted(
  ctx: VideoPipelineContext
): Promise<void> {
  await failVideo(ctx, {
    stage: 'transcribe',
    code: 'ALL_TRANSCRIPT_PROVIDERS_FAILED',
    message: 'All transcript providers failed',
  });
}
