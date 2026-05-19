import { VideoRepository } from '../repositories/video.repository';
import { CreditTransactionRepository } from '../repositories/credit-transaction.repository';
import { refundCredits } from '../services/credit.service';
import { logVideoEvent } from './log-video-event';
import type { FailVideoOptions, VideoPipelineContext } from './video-types';

export async function failVideo(
  ctx: VideoPipelineContext,
  options: FailVideoOptions
): Promise<void> {
  const { stage, code, message, refund = true } = options;

  await logVideoEvent({
    ctx,
    stage: stage === 'unknown' ? 'db' : stage,
    event: 'failed',
    msg: 'video_processing_failed',
    errorCode: code,
    errorMessage: message,
    outputSummary: { failureStage: stage, failureCode: code },
  });

  await VideoRepository.update(ctx.videoId, {
    status: 'failed',
    errorMessage: message,
    failureStage: stage,
    failureCode: code,
    lastStage: stage,
  });

  if (!refund) {
    return;
  }

  const initialTransaction = await CreditTransactionRepository.findOne({
    where: {
      userId: ctx.userId,
      referenceId: ctx.videoId.toString(),
      referenceType: 'video_submission_estimated',
    },
    order: { createdAt: 'DESC' },
  });

  if (initialTransaction) {
    await refundCredits({
      userId: ctx.userId,
      amount: Math.abs(initialTransaction.amount),
      description: `Refund: ${message}`,
      referenceId: ctx.videoId.toString(),
      referenceType: `${stage}_refund`,
      videoId: ctx.videoId,
    });
  }
}

export function buildPipelineContext(video: {
  id: number;
  userId: number;
  videoUrl: string;
  title?: string | null;
  correlationId?: string | null;
}): VideoPipelineContext {
  if (!video.correlationId) {
    throw new Error('Video missing correlationId');
  }
  return {
    correlationId: video.correlationId,
    videoId: video.id,
    userId: video.userId,
    videoUrl: video.videoUrl,
    videoTitle: video.title,
  };
}
