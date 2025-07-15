import { Type } from '@sinclair/typebox';

export const CreateUserBodySchema = Type.Object({
  name: Type.String({ description: 'Name of the user', example: 'John Doe' }),
  email: Type.String({
    format: 'email',
    description: 'Email of the user',
    example: 'user@example.com',
  }),
  password: Type.String({
    minLength: 6,
    description: 'Password of the user',
    example: 'password123',
  }),
});

export const LoginUserBodySchema = Type.Object({
  email: Type.String({
    format: 'email',
    description: 'Email of the user',
    example: 'user@example.com',
  }),
  password: Type.String({
    description: 'Password of the user',
    example: 'password123',
  }),
});

export const GetUserParamsSchema = Type.Object({
  id: Type.String({
    description: 'ID of the user',
    example: '1',
    pattern: '^[0-9]+$',
  }),
});

export const UserResponseSchema = Type.Object({
  id: Type.Number({ example: 1 }),
  name: Type.String({ example: 'John Doe' }),
  email: Type.String({ format: 'email', example: 'user@example.com' }),
  credits: Type.Number({ example: 100, description: 'User credit balance' }),
  avatarUrl: Type.Optional(Type.String({ example: 'https://example.com/avatar.jpg' })),
  provider: Type.Optional(Type.String({ example: 'google' })),
  providerId: Type.Optional(Type.String({ example: '123456789' })),
  createdAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
  updatedAt: Type.String({
    format: 'date-time',
    example: '2024-01-01T00:00:00.000Z',
  }),
});

export const LoginResponseSchema = Type.Object({
  user: UserResponseSchema,
  token: Type.String({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
});

export const ErrorResponseSchema = Type.Object({
  message: Type.String({ example: 'Error message' }),
});
