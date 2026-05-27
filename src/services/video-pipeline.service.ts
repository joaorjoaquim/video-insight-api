import { VideoRepository } from '../repositories/video.repository';
import { UserRepository } from '../repositories/user.repository';
import { VideoEntity } from '../entities/Video';
import { CreditTransactionRepository } from '../repositories/credit-transaction.repository';
import { TransactionType } from '../entities/CreditTransaction';
import { spendCredits, refundCredits, grantCreditsInternal } from './credit.service';
import { generateCorrelationId } from '../lib/generate-correlation-id';
import { buildPipelineContext, failVideo } from '../lib/fail-video';
import { logVideoEvent } from '../lib/log-video-event';
import { runWithVideoContext } from '../lib/request-context';
import type { VideoPipelineContext } from '../lib/video-types';
import {
  vdcDownloadVideo,
  vdcRequestTranscription,
  vdcCheckTranscriptionStatusOnce,
  mapVdcStatusToTranscript,
  fetchTranscriptWithFallback,
  failTranscriptExhausted,
} from './transcript-providers';
import {
  generateAIInsights,
  formatRawTranscription,
  calculateCreditsFromTokens,
} from './video-ai.service';

export async function createVideo(
  videoData: Partial<VideoEntity>
): Promise<VideoEntity> {
  const video = VideoRepository.create(videoData);
  return await VideoRepository.save(video);
}

function estimateCreditsFromDuration(durationSeconds: number | null | undefined): number {
  if (!durationSeconds) return 5;
  if (durationSeconds < 600) return 5;   // < 10 min
  if (durationSeconds < 1800) return 8;  // 10–30 min
  return 12;                             // > 30 min
}

export async function createVideoWithCredits(
  videoData: Partial<VideoEntity>,
  userId: number
): Promise<{ success: boolean; video?: VideoEntity; message?: string }> {
  // Duration is not yet available at submission time (populated during download stage)
  // so we default to 5 credits. Will be recalculated after transcription completes.
  const estimatedCredits = estimateCreditsFromDuration(videoData.duration as number | undefined);
  const user = await UserRepository.findOne({ where: { id: userId } });
  if (!user || user.credits < estimatedCredits) {
    return { success: false, message: 'Insufficient credits' };
  }

  const correlationId = generateCorrelationId();

  try {
    const video = await createVideo({
      ...videoData,
      correlationId,
      creditsCost: estimatedCredits,
      attemptCount: 0,
    });

    const creditSpent = await spendCredits({
      userId,
      amount: estimatedCredits,
      description: 'Video submission (estimated)',
      referenceId: video.id.toString(),
      referenceType: 'video_submission_estimated',
      videoId: video.id,
    });

    if (!creditSpent) {
      await VideoRepository.delete(video.id);
      return { success: false, message: 'Failed to create transaction' };
    }

    const ctx = buildPipelineContext(video);
    await logVideoEvent({
      ctx,
      stage: 'credits',
      event: 'completed',
      msg: 'video_created',
      outputSummary: { estimatedCredits },
    });

    return { success: true, video };
  } catch (error) {
    throw error;
  }
}

export async function getVideoById(id: number): Promise<VideoEntity | null> {
  return await VideoRepository.findOne({
    where: { id },
    relations: ['user'],
  });
}

async function incrementAttempt(videoId: number): Promise<void> {
  await VideoRepository.increment({ id: videoId }, 'attemptCount', 1);
}

export async function updateVideo(
  id: number,
  updateData: Partial<VideoEntity>
): Promise<VideoEntity | null> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await VideoRepository.update(id, updateData);
      return await getVideoById(id);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

async function runInContext<T>(
  videoId: number,
  fn: (ctx: VideoPipelineContext, video: VideoEntity) => Promise<T>
): Promise<T> {
  const video = await getVideoById(videoId);
  if (!video) {
    throw new Error('Video not found');
  }
  if (!video.correlationId) {
    const correlationId = generateCorrelationId();
    await VideoRepository.update(videoId, { correlationId });
    video.correlationId = correlationId;
  }
  const ctx = buildPipelineContext(video);
  return runWithVideoContext(ctx, () => fn(ctx, video));
}

export async function startVideoDownload(videoId: number): Promise<void> {
  await runInContext(videoId, async (ctx, video) => {
    await incrementAttempt(videoId);
    await logVideoEvent({
      ctx,
      stage: 'download',
      event: 'started',
      msg: 'download_pipeline_started',
    });

    if (video.status !== 'pending') {
      return;
    }

    try {
      const downloadResponse = await vdcDownloadVideo(ctx, video.videoUrl);

      if (!downloadResponse.success || !downloadResponse.data) {
        await logVideoEvent({
          ctx,
          stage: 'download',
          event: 'failed',
          msg: 'vdc_download_failed_trying_fallback',
        });

        const fallback = await fetchTranscriptWithFallback(ctx);
        if (fallback && 'pending' in fallback) {
          await updateVideo(videoId, {
            supadataJobId: fallback.jobId,
            processingProvider: 'supadata',
            status: 'transcribing',
          });
          return;
        }
        if (fallback && 'text' in fallback) {
          await updateVideo(videoId, {
            title: fallback.title ?? video.title,
            duration: fallback.duration,
            thumbnail: fallback.thumbnail,
            processingProvider: fallback.provider,
            status: 'transcribing',
          });
          await completeWithTranscript(
            videoId, ctx, fallback.text, fallback.provider,
            fallback.segments,
            fallback.duration ?? (typeof video.duration === 'number' ? video.duration : undefined)
          );
          return;
        }

        await failVideo(ctx, {
          stage: 'download',
          code: 'VDC_DOWNLOAD_FAILED',
          message: 'Failed to download video',
        });
        throw new Error('Failed to download video');
      }

      await updateVideo(videoId, {
        videoId: downloadResponse.data.videoId,
        title: downloadResponse.data.title,
        duration: downloadResponse.data.duration,
        thumbnail: downloadResponse.data.thumbnail,
        downloadUrl: downloadResponse.data.downloadUrl,
        processingProvider: 'videodowncut',
        status: 'downloaded',
        lastStage: 'download',
      });
    } catch (error) {
      const freshVideo = await getVideoById(videoId);
      if (freshVideo?.status !== 'failed') {
        const fallback = await fetchTranscriptWithFallback(ctx);
        if (fallback && 'pending' in fallback) {
          await updateVideo(videoId, {
            supadataJobId: fallback.jobId,
            processingProvider: 'supadata',
            status: 'transcribing',
          });
          return;
        }
        if (fallback && 'text' in fallback) {
          await updateVideo(videoId, {
            processingProvider: fallback.provider,
            status: 'transcribing',
          });
          await completeWithTranscript(
            videoId, ctx, fallback.text, fallback.provider,
            fallback.segments,
            typeof video.duration === 'number' ? video.duration : undefined
          );
          return;
        }
        await failVideo(ctx, {
          stage: 'download',
          code: 'VDC_DOWNLOAD_FAILED',
          message:
            error instanceof Error ? error.message : 'Download failed',
        });
      }
      throw error;
    }
  });
}

export async function startTranscription(videoId: number): Promise<void> {
  await runInContext(videoId, async (ctx, video) => {
    await incrementAttempt(videoId);

    if (video.status !== 'downloaded' || !video.videoId) {
      throw new Error('Video not found or not downloaded');
    }

    try {
      const transcriptionResponse = await vdcRequestTranscription(
        ctx,
        video.videoId,
        null
      );

      if (!transcriptionResponse.success || !transcriptionResponse.data) {
        const fallback = await fetchTranscriptWithFallback(ctx);
        if (fallback && 'pending' in fallback) {
          await updateVideo(videoId, {
            supadataJobId: fallback.jobId,
            processingProvider: 'supadata',
            status: 'transcribing',
          });
          return;
        }
        if (fallback && 'text' in fallback) {
          await completeWithTranscript(
            videoId, ctx, fallback.text, fallback.provider,
            fallback.segments,
            typeof video.duration === 'number' ? video.duration : undefined
          );
          return;
        }
        await failVideo(ctx, {
          stage: 'transcribe',
          code: 'VDC_TRANSCRIBE_FAILED',
          message: 'Failed to request transcription',
        });
        throw new Error('Failed to request transcription');
      }

      await updateVideo(videoId, {
        transcriptionId: transcriptionResponse.data.transcriptionId,
        status: 'transcribing',
        lastStage: 'transcribe',
      });
    } catch (error) {
      const fallback = await fetchTranscriptWithFallback(ctx);
      if (fallback && 'pending' in fallback) {
        await updateVideo(videoId, {
          supadataJobId: fallback.jobId,
          processingProvider: 'supadata',
          status: 'transcribing',
        });
        return;
      }
      if (fallback && 'text' in fallback) {
        await completeWithTranscript(
          videoId, ctx, fallback.text, fallback.provider,
          fallback.segments,
          typeof video.duration === 'number' ? video.duration : undefined
        );
        return;
      }
      await failVideo(ctx, {
        stage: 'transcribe',
        code: 'VDC_TRANSCRIBE_FAILED',
        message:
          error instanceof Error ? error.message : 'Transcription request failed',
      });
      throw error;
    }
  });
}

export async function checkTranscriptionStatus(
  videoId: number
): Promise<{ status: string; dashboard?: unknown }> {
  return runInContext(videoId, async (ctx, video) => {
    if (!video.transcriptionId && !video.supadataJobId) {
      if (video.status === 'downloaded') {
        await startTranscription(videoId);
        return { status: 'transcribing' };
      }
      throw new Error('Video not found or transcription not started');
    }

    if (video.supadataJobId) {
      const jobResult = await fetchTranscriptWithFallback(
        ctx,
        video.supadataJobId
      );
      if (jobResult && 'pending' in jobResult) {
        return { status: 'transcribing' };
      }
      if (jobResult && 'text' in jobResult) {
        return completeWithTranscript(
          videoId, ctx, jobResult.text, jobResult.provider,
          jobResult.segments,
          typeof video.duration === 'number' ? video.duration : undefined
        );
      }
      await failTranscriptExhausted(ctx);
      return { status: 'failed' };
    }

    if (!video.transcriptionId) {
      throw new Error('Video not found or transcription not started');
    }

    const statusData = await vdcCheckTranscriptionStatusOnce(
      ctx,
      video.transcriptionId
    );

    const transcript = mapVdcStatusToTranscript(statusData);
    if (transcript?.text) {
      return completeWithTranscript(
        videoId, ctx, transcript.text, 'videodowncut',
        transcript.segments,
        typeof video.duration === 'number' ? video.duration : undefined
      );
    }

    if (statusData.success && statusData.data?.status === 'failed') {
      const fallback = await fetchTranscriptWithFallback(ctx);
      if (fallback && 'text' in fallback) {
        return completeWithTranscript(
          videoId, ctx, fallback.text, fallback.provider,
          fallback.segments,
          typeof video.duration === 'number' ? video.duration : undefined
        );
      }
      if (fallback && 'pending' in fallback) {
        await updateVideo(videoId, {
          supadataJobId: fallback.jobId,
          processingProvider: 'supadata',
        });
        return { status: 'transcribing' };
      }
      await failVideo(ctx, {
        stage: 'transcribe',
        code: 'VDC_SERVICE_FAILED',
        message: 'Transcription failed at service level',
      });
      return { status: 'failed' };
    }

    return { status: 'transcribing' };
  });
}

async function completeWithTranscript(
  videoId: number,
  ctx: VideoPipelineContext,
  transcription: string,
  provider: string,
  segments?: Array<{ time: string; text: string }>,
  durationSeconds?: number
): Promise<{ status: string; dashboard?: unknown }> {
  const fullTranscript = segments?.length
    ? segments
    : formatRawTranscription(transcription, durationSeconds);
  let aiDashboard: Record<string, unknown> = {};
  let tokensUsed = 0;
  let insightsStatus: 'complete' | 'degraded' = 'complete';

  try {
    const aiResult = await generateAIInsights(transcription, ctx);
    aiDashboard = aiResult.dashboard;
    tokensUsed = aiResult.tokensUsed;
  } catch (aiError) {
    insightsStatus = 'degraded';
    await logVideoEvent({
      ctx,
      stage: 'ai',
      event: 'failed',
      msg: 'openai_insights_failed_degraded_complete',
      errorMessage:
        aiError instanceof Error ? aiError.message : 'AI processing failed',
      errorCode: 'OPENAI_FAILED',
    });
  }

  const completeDashboard = {
    ...aiDashboard,
    transcript: fullTranscript,
    meta: {
      correlationId: ctx.correlationId,
      insightsStatus,
      transcriptProvider: provider,
    },
  };

  const finalCreditsCost = calculateCreditsFromTokens(tokensUsed);

  const initialTransaction = await CreditTransactionRepository.findOne({
    where: {
      userId: ctx.userId,
      referenceId: videoId.toString(),
      referenceType: 'video_submission_estimated',
    },
    order: { createdAt: 'DESC' },
  });

  if (initialTransaction) {
    await CreditTransactionRepository.update(initialTransaction.id, {
      amount: -finalCreditsCost,
      description: `AI video analysis (${tokensUsed} tokens)`,
      referenceType: 'video_ai_processing',
      tokensUsed,
    });
  } else {
    const creditSpent = await spendCredits({
      userId: ctx.userId,
      amount: finalCreditsCost,
      description: `AI video analysis (${tokensUsed} tokens)`,
      referenceId: videoId.toString(),
      referenceType: 'video_ai_processing',
      tokensUsed,
      videoId,
    });
    if (!creditSpent) {
      await failVideo(ctx, {
        stage: 'credits',
        code: 'INSUFFICIENT_CREDITS',
        message: 'Insufficient credits for AI processing',
        refund: true,
      });
      return { status: 'failed' };
    }
  }

  await updateVideo(videoId, {
    transcription,
    dashboard: completeDashboard,
    tokensUsed,
    creditsCost: finalCreditsCost,
    processingProvider: provider,
    status: 'completed',
    lastStage: 'ai',
    failureStage: null,
    failureCode: null,
    errorMessage: null,
  });

  await logVideoEvent({
    ctx,
    stage: 'ai',
    event: 'completed',
    msg: 'video_processing_completed',
    provider,
    outputSummary: { tokensUsed, insightsStatus, transcriptLength: transcription.length },
  });

  await triggerReferralRewardIfEligible(ctx.userId);

  return { status: 'completed', dashboard: completeDashboard };
}

export async function processVideo(videoId: number): Promise<void> {
  const video = await getVideoById(videoId);
  if (!video) throw new Error('Video not found');

  const ctx = buildPipelineContext(video);

  try {
    if (video.status === 'pending') {
      await startVideoDownload(videoId);
    }
    const updated = await getVideoById(videoId);
    if (!updated || updated.status === 'failed') {
      throw new Error('Processing failed');
    }
    if (updated.status === 'downloaded') {
      await startTranscription(videoId);
    }
    const maxAttempts = parseInt(process.env.MAX_TRANSCRIPTION_POLLS || '120', 10);
    let attempts = 0;
    while (attempts < maxAttempts) {
      const result = await checkTranscriptionStatus(videoId);
      if (result.status === 'completed' || result.status === 'failed') {
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
      attempts++;
    }
    await failVideo(ctx, {
      stage: 'poll',
      code: 'PROCESSING_TIMEOUT',
      message: 'Processing timed out',
    });
    throw new Error('Processing timed out');
  } catch (error) {
    const current = await getVideoById(videoId);
    if (current?.status !== 'failed') {
      await failVideo(ctx, {
        stage: 'unknown',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    throw error;
  }
}

async function triggerReferralRewardIfEligible(userId: number): Promise<void> {
  try {
    const user = await UserRepository.findOne({ where: { id: userId } });
    if (!user || !user.referredByCode || user.referralRewardGranted) return;

    const completedCount = await VideoRepository.count({
      where: { userId, status: 'completed' },
    });

    if (completedCount !== 1) return;

    const referrer = await UserRepository.findOne({ where: { referralCode: user.referredByCode } });
    if (!referrer) return;

    await grantCreditsInternal(
      referrer.id,
      5,
      `Referral reward — ${user.email}`,
      'referral_reward',
      String(userId),
      TransactionType.REFERRAL_REWARD
    );

    await UserRepository.update(referrer.id, {
      referralCreditsEarned: referrer.referralCreditsEarned + 5,
    });

    await UserRepository.update(userId, { referralRewardGranted: true });
  } catch (err) {
    // Referral reward is non-critical — log but don't fail the video completion
    const { default: log } = await import('../config/logger');
    log.error({ err, userId }, 'referral_reward_trigger_error');
  }
}

export async function getVideosByUserId(
  userId: number,
  status?: string,
  limit?: number,
  offset?: number
): Promise<VideoEntity[]> {
  const queryBuilder = VideoRepository.createQueryBuilder('video')
    .where('video.userId = :userId', { userId })
    .orderBy('video.createdAt', 'DESC');
  if (status) queryBuilder.andWhere('video.status = :status', { status });
  if (limit) queryBuilder.limit(limit);
  if (offset) queryBuilder.offset(offset);
  return await queryBuilder.getMany();
}

export async function getVideosCountByUserId(
  userId: number,
  status?: string
): Promise<number> {
  const queryBuilder = VideoRepository.createQueryBuilder('video').where(
    'video.userId = :userId',
    { userId }
  );
  if (status) queryBuilder.andWhere('video.status = :status', { status });
  return await queryBuilder.getCount();
}

export async function getFailedVideos(
  userId?: number,
  limit: number = 50,
  offset: number = 0
): Promise<{
  videos: VideoEntity[];
  total: number;
  errorSummary: {
    downloadFailures: number;
    transcriptionFailures: number;
    aiProcessingFailures: number;
    creditFailures: number;
    unknownFailures: number;
  };
}> {
  const queryBuilder = VideoRepository.createQueryBuilder('video')
    .where('video.status = :status', { status: 'failed' })
    .orderBy('video.updatedAt', 'DESC');

  if (userId) {
    queryBuilder.andWhere('video.userId = :userId', { userId });
  }

  const videos = await queryBuilder.limit(limit).offset(offset).getMany();
  const total = await queryBuilder.getCount();

  const errorSummary = {
    downloadFailures: 0,
    transcriptionFailures: 0,
    aiProcessingFailures: 0,
    creditFailures: 0,
    unknownFailures: 0,
  };

  videos.forEach((video) => {
    const stage = video.failureStage || '';
    if (stage === 'download') errorSummary.downloadFailures++;
    else if (stage === 'transcribe' || stage === 'poll')
      errorSummary.transcriptionFailures++;
    else if (stage === 'ai') errorSummary.aiProcessingFailures++;
    else if (stage === 'credits') errorSummary.creditFailures++;
    else {
      const msg = video.errorMessage?.toLowerCase() || '';
      if (msg.includes('download') || msg.includes('videodowncut'))
        errorSummary.downloadFailures++;
      else if (msg.includes('transcription') || msg.includes('transcribe'))
        errorSummary.transcriptionFailures++;
      else if (msg.includes('ai') || msg.includes('openai'))
        errorSummary.aiProcessingFailures++;
      else if (msg.includes('credit')) errorSummary.creditFailures++;
      else errorSummary.unknownFailures++;
    }
  });

  return { videos, total, errorSummary };
}
