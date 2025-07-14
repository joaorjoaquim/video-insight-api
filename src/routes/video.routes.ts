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
            id: Type.Number(),
            videoUrl: Type.String(),
            status: Type.String(),
            userId: Type.Number(),
            createdAt: Type.String(),
            updatedAt: Type.String(),
            videoId: Type.Optional(Type.String()),
            title: Type.Optional(Type.String()),
            thumbnail: Type.Optional(Type.String()),
            duration: Type.Optional(Type.Number()),
            downloadUrl: Type.Optional(Type.String()),
            transcriptionId: Type.Optional(Type.String()),
            transcription: Type.Optional(Type.String()),
            errorMessage: Type.Optional(Type.String()),
            // Dashboard fields
            summary: Type.Optional(Type.Object({
              text: Type.String(),
              metrics: Type.Array(Type.Object({
                label: Type.String(),
                value: Type.String()
              })),
              topics: Type.Array(Type.String())
            })),
            transcript: Type.Optional(Type.Array(Type.Object({
              time: Type.String(),
              text: Type.String()
            }))),
            insights: Type.Optional(Type.Object({
              chips: Type.Array(Type.Object({
                label: Type.String(),
                variant: Type.String()
              })),
              sections: Type.Array(Type.Object({
                title: Type.String(),
                icon: Type.String(),
                items: Type.Array(Type.Object({
                  text: Type.String(),
                  confidence: Type.Optional(Type.Number()),
                  key: Type.Optional(Type.Boolean()),
                  quote: Type.Optional(Type.Boolean())
                }))
              }))
            })),
            mindMap: Type.Optional(Type.Object({
              root: Type.String(),
              branches: Type.Array(Type.Object({
                label: Type.String(),
                children: Type.Array(Type.Object({
                  label: Type.String()
                }))
              }))
            })),
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
