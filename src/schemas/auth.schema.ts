import { Type } from '@sinclair/typebox';

// Signup Schema
export const SignupBodySchema = Type.Object({
  email: Type.String({
    format: 'email',
    description: 'Email do usuário',
    example: 'user@example.com',
  }),
  password: Type.String({
    minLength: 6,
    description: 'Senha do usuário',
    example: '123456',
  }),
});

// Login Schema
export const LoginBodySchema = Type.Object({
  email: Type.String({
    format: 'email',
    description: 'Email do usuário',
    example: 'user@example.com',
  }),
  password: Type.String({
    minLength: 6,
    description: 'Senha do usuário',
    example: '123456',
  }),
});

// User Response Schema
export const UserResponseSchema = Type.Object({
  id: Type.Number({ description: 'ID do usuário' }),
  email: Type.String({ description: 'Email do usuário' }),
  name: Type.String({ description: 'Nome do usuário' }),
  avatarUrl: Type.Optional(Type.String({ description: 'URL do avatar' })),
  provider: Type.Optional(
    Type.String({ description: 'Provedor OAuth (google, discord)' })
  ),
  providerId: Type.Optional(
    Type.String({ description: 'ID do usuário no provedor OAuth' })
  ),
  createdAt: Type.String({
    format: 'date-time',
    description: 'Data de criação',
  }),
  updatedAt: Type.String({
    format: 'date-time',
    description: 'Data de atualização',
  }),
});

// Auth Response Schema
export const AuthResponseSchema = Type.Object({
  user: UserResponseSchema,
  token: Type.String({
    description: 'Token JWT gerado',
    example: 'jwt_token_here',
  }),
});

// OAuth Provider Schema
export const OAuthProviderSchema = Type.Union([
  Type.Literal('google'),
  Type.Literal('discord'),
]);

// Error Response Schema
export const ErrorResponseSchema = Type.Object({
  message: Type.String({ description: 'Mensagem de erro' }),
});
