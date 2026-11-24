import { Type } from '@sinclair/typebox';

export const UserResponseSchema = Type.Object({
  id: Type.Number({ example: 1 }),
  name: Type.String({ example: 'John Doe' }),
  email: Type.String({ format: 'email', example: 'user@example.com' }),
  credits: Type.Number({ example: 100, description: 'User credit balance' }),
  avatarUrl: Type.Optional(Type.String({ example: 'https://example.com/avatar.jpg' })),
  provider: Type.Optional(Type.String({ example: 'google' })),
  providerId: Type.Optional(Type.String({ example: '123456789' })),
  githubUsername: Type.Union([Type.String(), Type.Null()], { description: 'Linked GitHub username, null if not linked', example: 'octocat' }),
  githubStarClaimedWeb: Type.Boolean({ description: 'Star claimed for video-insight-web repo', example: false }),
  githubForkClaimedWeb: Type.Boolean({ description: 'Fork claimed for video-insight-web repo', example: false }),
  githubStarClaimedApi: Type.Boolean({ description: 'Star claimed for video-insight-api repo', example: false }),
  githubForkClaimedApi: Type.Boolean({ description: 'Fork claimed for video-insight-api repo', example: false }),
  createdAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
  updatedAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
});

export const ErrorResponseSchema = Type.Object({
  message: Type.String({ example: 'Error message' }),
});
