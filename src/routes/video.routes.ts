import { FastifyInstance } from 'fastify';
import {
  createVideoHandler,
  getVideoHandler,
  getUserVideosHandler,
  processVideoHandler,
  checkVideoStatusHandler,
} from '../controllers/video.controller';
import {
  CreateVideoBodySchema,
  GetVideoParamsSchema,
  ProcessVideoParamsSchema,
  VideoResponseSchema,
  VideoListResponseSchema,
  VideoDetailResponseSchema,
  VideoStatusResponseSchema,
  ErrorResponseSchema,
} from '../schemas/video.schema';
import { Type } from '@sinclair/typebox';

export async function videoRoutes(fastify: FastifyInstance) {
  // Apply authentication to all video routes
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post(
    '/',
    {
      schema: {
        body: CreateVideoBodySchema,
        response: {
          201: VideoResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    createVideoHandler
  );

  fastify.get(
    '/',
    {
      schema: {
        querystring: Type.Object({
          status: Type.Optional(
            Type.String({ description: 'Filter by video status' })
          ),
          limit: Type.Optional(
            Type.Number({ description: 'Number of videos to return' })
          ),
          offset: Type.Optional(
            Type.Number({ description: 'Number of videos to skip' })
          ),
        }),
        response: {
          200: Type.Object({
            videos: VideoListResponseSchema,
            pagination: Type.Object({
              total: Type.Number(),
              limit: Type.Number(),
              offset: Type.Number(),
            }),
          }),
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    getUserVideosHandler
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: GetVideoParamsSchema,
        response: {
          200: VideoDetailResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    getVideoHandler
  );

  fastify.post(
    '/:id/process',
    {
      schema: {
        params: ProcessVideoParamsSchema,
        response: {
          202: Type.Object({
            message: Type.String(),
            videoId: Type.Number(),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    processVideoHandler
  );

  fastify.get(
    '/:id/status',
    {
      schema: {
        params: GetVideoParamsSchema,
        response: {
          200: VideoStatusResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    checkVideoStatusHandler
  );
}
