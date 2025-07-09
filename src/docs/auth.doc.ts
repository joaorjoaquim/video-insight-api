import {
  LoginBodySchema,
  SignupBodySchema,
  AuthResponseSchema,
  OAuthProviderSchema,
} from '../schemas/auth.schema';
import { Type } from '@sinclair/typebox';

export const signupDocSchema = {
  description: 'Cria uma nova conta de usuário (nome extraído do email)',
  tags: ['Authentication'],
  body: SignupBodySchema,
  response: {
    201: AuthResponseSchema,
    409: Type.Object({ message: Type.String() }),
    500: Type.Object({ message: Type.String() }),
  },
};

export const loginDocSchema = {
  description: 'Realiza login com email e senha',
  tags: ['Authentication'],
  body: LoginBodySchema,
  response: {
    200: AuthResponseSchema,
    401: Type.Object({ message: Type.String() }),
    500: Type.Object({ message: Type.String() }),
  },
};

export const oauthRedirectDocSchema = {
  description: 'Redireciona para o provedor OAuth (Google ou Discord)',
  tags: ['Authentication'],
  params: Type.Object({
    provider: OAuthProviderSchema,
  }),
  response: {
    302: Type.Null(), // Redirect response
    400: Type.Object({ message: Type.String() }),
    500: Type.Object({ message: Type.String() }),
  },
};

export const oauthCallbackDocSchema = {
  description:
    'Callback do OAuth - processa o código de autorização e retorna token JWT',
  tags: ['Authentication'],
  params: Type.Object({
    provider: OAuthProviderSchema,
  }),
  querystring: Type.Object({
    code: Type.String({
      description: 'Código de autorização do provedor OAuth',
    }),
  }),
  response: {
    200: AuthResponseSchema,
    400: Type.Object({ message: Type.String() }),
    500: Type.Object({ message: Type.String() }),
  },
};
