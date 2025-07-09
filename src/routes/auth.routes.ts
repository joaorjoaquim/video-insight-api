import { FastifyInstance } from 'fastify';
import {
  loginController,
  signupController,
  oauthRedirectController,
  oauthCallbackController,
} from '../controllers/auth.controller';
import {
  LoginBodySchema,
  SignupBodySchema,
  AuthResponseSchema,
  ErrorResponseSchema,
  OAuthProviderSchema,
} from '../schemas/auth.schema';
import { Type } from '@sinclair/typebox';

export async function authRoutes(fastify: FastifyInstance) {
  // Signup route
  fastify.post(
    '/signup',
    {
      schema: {
        body: SignupBodySchema,
        response: {
          201: AuthResponseSchema,
          409: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    signupController
  );

  // Login route
  fastify.post(
    '/login',
    {
      schema: {
        body: LoginBodySchema,
        response: {
          200: AuthResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    loginController
  );

  // OAuth redirect route
  fastify.get(
    '/oauth/:provider',
    {
      schema: {
        params: Type.Object({
          provider: OAuthProviderSchema,
        }),
        response: {
          302: Type.Null(), // Redirect response
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    oauthRedirectController
  );

  // OAuth callback route
  fastify.get(
    '/callback/:provider',
    {
      schema: {
        params: Type.Object({
          provider: OAuthProviderSchema,
        }),
        querystring: Type.Object({
          code: Type.String({
            description: 'Authorization code from OAuth provider',
          }),
        }),
        response: {
          200: AuthResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    oauthCallbackController
  );
}
