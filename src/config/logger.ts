import pino from 'pino';
import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

// Create a simple logger configuration that works in all environments
const loggerOptions: pino.LoggerOptions = {
  level: isProduction ? 'info' : 'debug',
  
  // Only use pino-pretty in local development, not in serverless environments
  ...(isDevelopment && !isVercel
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      }
    : {}),

  base: {
    app: process.env.APP_NAME || 'api',
    env: process.env.NODE_ENV || 'development',
  },

  serializers: {
    err: pino.stdSerializers.err,
    error: (error: any) => {
      if (!error) return error;

      return {
        message: error.message,
        stack: error.stack,
        code: error.code,
        detail: error.detail,
        name: error.name,
      };
    },
  },
};

// Create logger with error handling for serverless environments
let logger: pino.Logger;

try {
  // In Vercel, use a minimal configuration
  if (isVercel) {
    logger = pino({
      level: 'info',
      base: {
        app: process.env.APP_NAME || 'api',
        env: 'production',
      },
    });
  } else {
    logger = pino(loggerOptions);
  }
} catch (error) {
  // Fallback logger for any environment
  logger = pino({
    level: 'info',
    base: {
      app: process.env.APP_NAME || 'api',
      env: process.env.NODE_ENV || 'development',
    },
  });
}

export default logger;
