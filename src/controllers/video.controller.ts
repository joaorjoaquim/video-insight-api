import { FastifyRequest, FastifyReply } from 'fastify';
import {
  createVideo,
  getVideoById,
  getVideosByUserId,
  processVideo,
  startVideoDownload,
  startTranscription,
  checkTranscriptionStatus,
} from '../services/video.service';

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

    const videoData = {
      videoUrl,
      userId,
      status: 'pending' as const,
    };

    const video = await createVideo(videoData);

    // Start processing in background
    startVideoDownload(video.id).catch((error) => {
      console.error('Video download error:', error);
    });

    return reply.status(201).send({
      ...video,
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

    // Ensure user can only access their own videos
    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    return reply.send(video);
  } catch (error) {
    return reply.status(500).send({
      message: error instanceof Error ? error.message : 'Failed to get video',
    });
  }
}

export async function getUserVideosHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const userId = (request.user as any)?.userId;

    if (!userId) {
      return reply.status(401).send({ message: 'Authentication required' });
    }

    const videos = await getVideosByUserId(userId);

    return reply.send(videos);
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

    // Ensure user can only check their own videos
    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    // Check current status and continue processing if needed
    let statusResult: {
      status:
        | 'pending'
        | 'downloaded'
        | 'transcribing'
        | 'completed'
        | 'failed';
    } = { status: video.status };

    if (video.status === 'pending') {
      // Start download if not started
      try {
        await startVideoDownload(video.id);
        statusResult = { status: 'downloaded' };
      } catch (error) {
        statusResult = { status: 'failed' };
      }
    } else if (video.status === 'downloaded') {
      // Start transcription if not started
      try {
        await startTranscription(video.id);
        statusResult = { status: 'transcribing' };
      } catch (error) {
        statusResult = { status: 'failed' };
      }
    } else if (video.status === 'transcribing') {
      // Check transcription status
      try {
        const result = await checkTranscriptionStatus(video.id);
        statusResult = {
          status: result.status as
            | 'pending'
            | 'downloaded'
            | 'transcribing'
            | 'completed'
            | 'failed',
        };
      } catch (error) {
        statusResult = { status: 'failed' };
      }
    }

    // Get updated video data
    const updatedVideo = await getVideoById(parseInt(id));

    return reply.send({
      video: updatedVideo,
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

    // Ensure user can only process their own videos
    if (video.userId !== userId) {
      return reply.status(403).send({ message: 'Access denied' });
    }

    // Start processing in background
    processVideo(parseInt(id)).catch((error) => {
      console.error('Video processing error:', error);
    });

    return reply.status(202).send({
      message: 'Video processing started',
      videoId: parseInt(id),
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
