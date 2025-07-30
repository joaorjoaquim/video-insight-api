import { Type } from '@sinclair/typebox';

export const GetCreditsResponseSchema = Type.Object({
  credits: Type.Number({ example: 25 }),
  transactions: Type.Array(
    Type.Object({
      id: Type.Number({ example: 1 }),
      amount: Type.Number({ example: -1 }),
      type: Type.String({ example: 'spend' }),
      status: Type.String({ example: 'completed' }),
      description: Type.String({ example: 'Video submission' }),
      referenceId: Type.Optional(Type.String({ example: 'VID-123' })),
      referenceType: Type.Optional(
        Type.String({ example: 'video_submission' })
      ),
      tokensUsed: Type.Optional(Type.Number({ example: 1500 })),
      userId: Type.Number({ example: 5 }),
      createdAt: Type.String({ example: '2025-07-15T00:00:00.000Z' }),
      video: Type.Optional(
        Type.Object({
          id: Type.Number({ example: 36 }),
          title: Type.String({ example: 'How to Build a React App' }),
          duration: Type.Number({ example: 1250.5 }),
          status: Type.String({ example: 'completed' }),
        })
      ),
    })
  ),
  pagination: Type.Object({
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  }),
});

export const AdminCreditRequestSchema = Type.Object({
  userId: Type.Optional(Type.Number({ example: 5 })),
  amount: Type.Number({ example: 10, minimum: 1 }),
  description: Type.String({ example: 'Admin credit grant' }),
});

export const AdminCreditResponseSchema = Type.Object({
  message: Type.String({ example: 'Credits granted successfully' }),
  success: Type.Boolean({ example: true }),
});

export const ErrorResponseSchema = Type.Object({
  message: Type.String({ example: 'Error message' }),
});
