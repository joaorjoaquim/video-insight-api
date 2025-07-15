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

// Full video response with dashboard data (for GET /videos/:id)
export const VideoDetailResponseSchema = Type.Object({
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
  // Dashboard fields (only when status is 'completed')
  summary: Type.Optional(
    Type.Object({
      text: Type.String({
        example: 'A music video featuring Rick Astley performing his hit song.',
      }),
      metrics: Type.Array(
        Type.Object({
          label: Type.String({ example: 'Duration' }),
          value: Type.String({ example: '3:33' }),
        })
      ),
      topics: Type.Array(Type.String({ example: 'Music' })),
    })
  ),
  transcript: Type.Optional(
    Type.Array(
      Type.Object({
        time: Type.String({ example: '00:00' }),
        text: Type.String({ example: "We're no strangers to love..." }),
      })
    )
  ),
  insights: Type.Optional(
    Type.Object({
      chips: Type.Array(
        Type.Object({
          label: Type.String({ example: '15 insights extracted' }),
          variant: Type.String({ example: 'secondary' }),
        })
      ),
      sections: Type.Array(
        Type.Object({
          title: Type.String({ example: 'Key Insights' }),
          icon: Type.String({ example: '💡' }),
          items: Type.Array(
            Type.Object({
              text: Type.String({
                example: 'Leadership is not just about scoring...',
              }),
              confidence: Type.Optional(Type.Number({ example: 95 })),
              key: Type.Optional(Type.Boolean({ example: true })),
              quote: Type.Optional(Type.Boolean({ example: false })),
            })
          ),
        })
      ),
    })
  ),
  mindMap: Type.Optional(
    Type.Object({
      root: Type.String({ example: 'Video Insights' }),
      branches: Type.Array(
        Type.Object({
          label: Type.String({ example: 'Leadership' }),
          children: Type.Array(
            Type.Object({
              label: Type.String({ example: 'Teamwork' }),
            })
          ),
        })
      ),
    })
  ),
});

// Status response schema (for GET /videos/:id/status)
export const VideoStatusResponseSchema = Type.Object({
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
  message: Type.String({ example: 'Video status: completed' }),
});

export const ErrorResponseSchema = Type.Object({
  message: Type.String({ example: 'Error message' }),
});
