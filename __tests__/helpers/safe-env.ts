import path from 'path';

// src/config/logger.ts and src/config/db.config.ts load dotenv on import. Pointing dotenv at a file that
// does not exist keeps the repo's .env out of the test process, and the DB settings below can only ever
// name a closed loopback port.
process.env.DOTENV_CONFIG_PATH = path.join(__dirname, 'no-such-file.env');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL_WRITE = '';
process.env.DATABASE_URL_READ = '';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';
process.env.DISABLE_REDIS = 'true';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.OPENAI_API_KEY = 'unused-in-tests';
process.env.JWT_SECRET = 'test-only-jwt-secret-0123456789-abcdefghij';
process.env.LOG_LEVEL = 'silent';
