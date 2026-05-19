import { FastifyRequest, FastifyReply } from 'fastify';
import { waitUntil } from '@vercel/functions';
import {
  createVideoWithCredits,
  getVideoById,
  getVideosByUserId,
  getVideosCountByUserId,
  processVideo,
  startVideoDownload,
  startTranscription,
  checkTranscriptionStatus,
  getFailedVideos,
  getVideoTrace,
} from '../services/video.service';
import { logVideoEvent } from '../lib/log-video-event';
import { runWithVideoContext } from '../lib/request-context';
import { buildPipelineContext } from '../lib/fail-video';

interface CreateVideoRequest {
  Body: {
    videoUrl: string;
  };
}

interface GetVideoRequest {
  Params: {
    id: string;
  };
}

interface GetUserVideosRequest {
  Querystring: {
    status?: string;
    limit?: string;
    offset?: string;
  };
}

interface ProcessVideoRequest {
  Params: {
    id: string;
  };
}

interface CheckStatusRequest {
  Params: {
    id: string;
  };
}

interface GetFailedVideosRequest {
  Querystring: {
    limit?: string;
    offset?: string;
  };
}

function isVercel(): boolean {
  return process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
}

function scheduleBackgroundDownload(videoId: number): void {
  const task = startVideoDownload(videoId).catch((error) => {
    logVideoEvent({
      stage: 'download',
      event: 'failed',
      msg: 'background_download_error',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
  });

  if (isVercel()) {
    waitUntil(task);
  }
}

export async function createVideoHandler(
  request: FastifyRequest<CreateVideoRequest>,
  reply: FastifyReply
) {
  try {
    const { videoUrl } = request.body;
    const userId = (request.user as any)?.userId;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const result = await createVideoWithCredits(
      { videoUrl, userId, status: 'pending' },
      userId
    );

    if (!result.success) {
      return reply.status(400).send({
        message: result.message || 'Failed to create video',
      });
    }

    const video = result.video!;

    await logVideoEvent({
      ctx: buildPipelineContext(video),
      stage: 'http',
      event: 'completed',
      msg: 'video_create_accepted',
      outputSummary: { videoId: video.id },
    });

    scheduleBackgroundDownload(video.id);

    return reply.status(201).send({
      ...video,
      correlationId: video.correlationId,
      message: 'Video created and processing started',
    });
  } catch (error) {
    return reply.status(400).send({
      message:
        error instanceof Error ? error.message : 'Failed to create video',
    });
  }
}

export async function getVideoHandler(
  request: FastifyRequest<GetVideoRequest>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const userId = (request.user as any)?.userId;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const video = await getVideoById(parseInt(id));

    if (!video) {
      return reply.status(404).send({ message: 'Video not found' });
    }

    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    let response = { ...video } as Record<string, unknown>;
    if (
      video.dashboard &&
      typeof video.dashboard === 'object' &&
      video.status === 'completed'
    ) {
      response = {
        ...video,
        correlationId: video.correlationId,
        summary: video.dashboard.summary,
        insights: video.dashboard.insights,
        transcript: video.dashboard.transcript,
        mindMap: video.dashboard.mindMap,
        meta: video.dashboard.meta,
      };
    }

    return reply.send(response);
  } catch (error) {
    return reply.status(500).send({
      message: error instanceof Error ? error.message : 'Failed to get video',
    });
  }
}

export async function getUserVideosHandler(
  request: FastifyRequest<GetUserVideosRequest>,
  reply: FastifyReply
) {
  try {
    const userId = (request.user as any)?.userId;
    const { status, limit, offset } = request.query;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const videos = await getVideosByUserId(
      userId,
      status,
      limit ? parseInt(limit) : undefined,
      offset ? parseInt(offset) : undefined
    );

    const totalCount = await getVideosCountByUserId(userId, status);

    return reply.send({
      videos,
      pagination: {
        total: totalCount,
        limit: limit ? parseInt(limit) : videos.length,
        offset: offset ? parseInt(offset) : 0,
      },
    });
  } catch (error) {
    return reply.status(500).send({
      message:
        error instanceof Error ? error.message : 'Failed to get user videos',
    });
  }
}

export async function checkVideoStatusHandler(
  request: FastifyRequest<CheckStatusRequest>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const userId = (request.user as any)?.userId;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const video = await getVideoById(parseInt(id));

    if (!video) {
      return reply.status(404).send({ message: 'Video not found' });
    }

    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    const headerCorrelationId = request.headers['x-correlation-id'];
    if (video.correlationId) {
      const ctx = buildPipelineContext(video);
      await runWithVideoContext(ctx, async () => {
        await logVideoEvent({
          ctx,
          stage: 'http',
          event: 'started',
          msg: 'status_poll_received',
          inputSummary: {
            statusBefore: video.status,
            headerCorrelationId:
              typeof headerCorrelationId === 'string'
                ? headerCorrelationId
                : undefined,
          },
        });
      });
    }

    let statusResult: {
      status:
        | 'pending'
        | 'downloaded'
        | 'transcribing'
        | 'completed'
        | 'failed';
    } = { status: video.status };

    if (video.status === 'pending') {
      try {
        await startVideoDownload(video.id);
        statusResult = { status: 'downloaded' };
      } catch {
        statusResult = { status: 'failed' };
      }
    } else if (video.status === 'downloaded') {
      try {
        await startTranscription(video.id);
        statusResult = { status: 'transcribing' };
      } catch {
        statusResult = { status: 'failed' };
      }
    } else if (video.status === 'transcribing') {
      try {
        const result = await checkTranscriptionStatus(video.id);
        statusResult = {
          status: result.status as typeof statusResult.status,
        };
      } catch {
        statusResult = { status: 'failed' };
      }
    }

    const updatedVideo = await getVideoById(parseInt(id));

    return reply.send({
      ...updatedVideo,
      correlationId: updatedVideo?.correlationId,
      lastStage: updatedVideo?.lastStage,
      failureStage: updatedVideo?.failureStage,
      failureCode: updatedVideo?.failureCode,
      processingProvider: updatedVideo?.processingProvider,
      attemptCount: updatedVideo?.attemptCount,
      status: statusResult.status,
      message: `Video status: ${statusResult.status}`,
    });
  } catch (error) {
    return reply.status(500).send({
      message:
        error instanceof Error ? error.message : 'Failed to check video status',
    });
  }
}

export async function processVideoHandler(
  request: FastifyRequest<ProcessVideoRequest>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const userId = (request.user as any)?.userId;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const video = await getVideoById(parseInt(id));

    if (!video) {
      return reply.status(404).send({ message: 'Video not found' });
    }

    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    const task = processVideo(parseInt(id)).catch((error) => {
      request.log.error({ err: error, videoId: id }, 'Video processing error');
    });

    if (isVercel()) {
      waitUntil(task);
    }

    return reply.status(202).send({
      message: 'Video processing started',
      videoId: parseInt(id),
      correlationId: video.correlationId,
    });
  } catch (error) {
    return reply.status(500).send({
      message:
        error instanceof Error
          ? error.message
          : 'Failed to start video processing',
    });
  }
}

export async function getFailedVideosHandler(
  request: FastifyRequest<GetFailedVideosRequest>,
  reply: FastifyReply
) {
  try {
    const userId = (request.user as any)?.userId;
    const { limit, offset } = request.query;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const result = await getFailedVideos(
      userId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0
    );

    return reply.send({
      videos: result.videos,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
      },
      errorSummary: result.errorSummary,
    });
  } catch (error) {
    return reply.status(500).send({
      message:
        error instanceof Error ? error.message : 'Failed to get failed videos',
    });
  }
}

export async function getVideoTraceHandler(
  request: FastifyRequest<GetVideoRequest>,
  reply: FastifyReply
) {
  try {
    const userId = (request.user as any)?.userId;
    const videoId = parseInt(request.params.id);

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const video = await getVideoById(videoId);
    if (!video) {
      return reply.status(404).send({ message: 'Video not found' });
    }
    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    const trace = await getVideoTrace(videoId);
    return reply.send(trace);
  } catch (error) {
    return reply.status(500).send({
      message:
        error instanceof Error ? error.message : 'Failed to get video trace',
    });
  }
}
