import { Type } from '@sinclair/typebox';

export const CreateVideoBodySchema = Type.Object({
  videoUrl: Type.String({
    description: 'URL of the video to process',
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    format: 'uri',
  }),
});

export const GetVideoParamsSchema = Type.Object({
  id: Type.String({
    description: 'ID of the video',
    example: '1',
    pattern: '^[0-9]+$',
  }),
});

export const ProcessVideoParamsSchema = Type.Object({
  id: Type.String({
    description: 'ID of the video to process',
    example: '1',
    pattern: '^[0-9]+$',
  }),
});

export const VideoResponseSchema = Type.Object({
  id: Type.Number({ example: 1 }),
  videoUrl: Type.String({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  }),
  videoId: Type.Optional(Type.String({ example: 'dQw4w9WgXcQ' })),
  title: Type.Optional(
    Type.String({ example: 'Rick Astley - Never Gonna Give You Up' })
  ),
  thumbnail: Type.Optional(
    Type.String({
      example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    })
  ),
  duration: Type.Optional(Type.Number({ example: 212.73 })),
  downloadUrl: Type.Optional(
    Type.String({ example: '/api/videos/download/dQw4w9WgXcQ/dQw4w9WgXcQ.mp4' })
  ),
  transcriptionId: Type.Optional(
    Type.String({ example: '550e8400-e29b-41d4-a716-446655440000' })
  ),
  transcription: Type.Optional(
    Type.String({ example: "We're no strangers to love..." })
  ),
  summary: Type.Optional(
    Type.String({
      example: 'A music video featuring Rick Astley performing his hit song.',
    })
  ),
  insights: Type.Optional(
    Type.Any({ example: { topics: ['music', 'pop'], technicalExamples: [] } })
  ),
  status: Type.String({
    example: 'completed',
    enum: ['pending', 'downloaded', 'transcribing', 'completed', 'failed'],
  }),
  errorMessage: Type.Optional(
    Type.String({ example: 'Failed to download video' })
  ),
  userId: Type.Number({ example: 1 }),
  createdAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
  updatedAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
});

export const VideoListResponseSchema = Type.Array(VideoResponseSchema);

export const ErrorResponseSchema = Type.Object({
  message: Type.String({ example: 'Error message' }),
});
