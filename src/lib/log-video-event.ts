import logger from '../config/logger';
import { VideoRepository } from '../repositories/video.repository';
import { VideoProcessingLogRepository } from '../repositories/video-processing-log.repository';
import { getVideoContext } from './request-context';
import type {
  PipelineEvent,
  PipelineStage,
  VideoPipelineContext,
} from './video-types';

export interface LogVideoEventPayload {
  ctx?: VideoPipelineContext;
  stage: PipelineStage;
  event: PipelineEvent;
  msg: string;
  provider?: string;
  externalRequestId?: string;
  durationMs?: number;
  httpStatus?: number;
  attempt?: number;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

function resolveContext(
  ctx?: VideoPipelineContext
): VideoPipelineContext | undefined {
  return ctx ?? getVideoContext();
}

export async function logVideoEvent(
  payload: LogVideoEventPayload
): Promise<void> {
  const ctx = resolveContext(payload.ctx);
  const logPayload = {
    correlationId: ctx?.correlationId,
    videoId: ctx?.videoId,
    userId: ctx?.userId,
    videoTitle: ctx?.videoTitle,
    videoUrl: ctx?.videoUrl,
    stage: payload.stage,
    event: payload.event,
    msg: payload.msg,
    provider: payload.provider,
    externalRequestId: payload.externalRequestId,
    durationMs: payload.durationMs,
    httpStatus: payload.httpStatus,
    attempt: payload.attempt ?? 1,
    inputSummary: payload.inputSummary,
    outputSummary: payload.outputSummary,
    errorCode: payload.errorCode,
    errorMessage: payload.errorMessage,
  };

  if (payload.event === 'failed') {
    logger.error(logPayload, payload.msg);
  } else if (payload.event === 'retry') {
    logger.warn(logPayload, payload.msg);
  } else {
    logger.info(logPayload, payload.msg);
  }

  if (!ctx?.videoId || process.env.LOG_TO_DB === 'false') {
    return;
  }

  try {
    await VideoProcessingLogRepository.insert({
      correlationId: ctx.correlationId,
      videoId: ctx.videoId,
      userId: ctx.userId,
      videoTitle: ctx.videoTitle ?? null,
      videoUrl: ctx.videoUrl,
      stage: payload.stage,
      event: payload.event,
      msg: payload.msg,
      provider: payload.provider ?? null,
      externalRequestId: payload.externalRequestId ?? null,
      durationMs: payload.durationMs ?? null,
      httpStatus: payload.httpStatus ?? null,
      attempt: payload.attempt ?? 1,
      inputSummary: payload.inputSummary ?? null,
      outputSummary: payload.outputSummary ?? null,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
    });

    await VideoRepository.update(ctx.videoId, {
      lastStage: payload.stage,
    });
  } catch (err) {
    logger.warn(
      { err, correlationId: ctx.correlationId, videoId: ctx.videoId },
      'failed_to_persist_video_processing_log'
    );
  }
}

export async function getVideoTrace(
  videoId: number,
  limit = 200
): Promise<{ correlationId: string | null; events: unknown[] }> {
  const video = await VideoRepository.findOne({ where: { id: videoId } });
  if (!video?.correlationId) {
    return { correlationId: null, events: [] };
  }

  const events = await VideoProcessingLogRepository.find({
    where: { correlationId: video.correlationId },
    order: { createdAt: 'ASC' },
    take: limit,
  });

  return { correlationId: video.correlationId, events };
}
