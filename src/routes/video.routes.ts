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
        response: {
          200: VideoListResponseSchema,
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
          200: VideoResponseSchema,
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
          200: Type.Object({
            video: VideoResponseSchema,
            status: Type.String(),
            message: Type.String(),
          }),
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
