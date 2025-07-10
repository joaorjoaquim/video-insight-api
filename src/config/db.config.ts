import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import logger from './logger';

const isTestEnv =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'homolog';

const MAX_RETRIES = 5;
const baseConfig: Partial<DataSourceOptions> = {
  type: 'postgres',
  entities: [__dirname + '/../entities/*.{js,ts}'],
  migrations: [__dirname + '/../migrations/*.{js,ts}'],
  synchronize: isTestEnv ? true : false,
  ssl: {
    rejectUnauthorized: false,
  },
  extra: {
    max: Number(process.env.DB_MAX_CONNECTION) || 10,
    connectionTimeoutMillis: 60000,
    idleTimeoutMillis: 60000,
    keepAlive: true,
  },
};

function parseDatabaseUrl(url: string) {
  try {
    // Handle both postgres:// and postgresql:// protocols
    const withoutProtocol = url.replace(/^postgres(ql)?:\/\//, '');

    // Split by @ to separate auth from server
    const [auth, serverPart] = withoutProtocol.split('@');

    // Handle password with special characters
    const username = auth.split(':')[0];
    const password = auth.split(':').slice(1).join(':');

    let host, port, database;
    
    // Remove query parameters from serverPart
    const [serverWithoutQuery] = serverPart.split('?');
    
    if (serverWithoutQuery.includes(':')) {
      const [hostPort, db] = serverWithoutQuery.split('/');
      const [hostPart, portPart] = hostPort.split(':');
      host = hostPart;
      port = parseInt(portPart, 10);
      database = db;
    } else {
      const [hostPart, db] = serverWithoutQuery.split('/');
      host = hostPart;
      port = 5432;
      database = db;
    }

    return {
      host,
      port,
      username,
      password,
      database,
    };
  } catch (error) {
    throw new Error(
      `Falha ao analisar a URL do banco de dados: ${error.message}`
    );
  }
}

// In development, use individual variables; in production, use full URLs
const isDevelopment = process.env.NODE_ENV === 'development';

console.log('Database configuration:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL_WRITE exists:', !!process.env.DATABASE_URL_WRITE);
console.log('DATABASE_URL_READ exists:', !!process.env.DATABASE_URL_READ);

const writeConfig = isDevelopment
  ? {
      ...baseConfig,
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      username: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'test',
    }
  : process.env.DATABASE_URL_WRITE
    ? { ...baseConfig, ...parseDatabaseUrl(process.env.DATABASE_URL_WRITE) }
    : {
        ...baseConfig,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        username: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'test',
      };

const readConfig = isDevelopment
  ? writeConfig
  : process.env.DATABASE_URL_READ
    ? { ...baseConfig, ...parseDatabaseUrl(process.env.DATABASE_URL_READ) }
    : writeConfig;

console.log('Write config host:', writeConfig.host);
console.log('Write config database:', writeConfig.database);
console.log('Read config host:', readConfig.host);
console.log('Read config database:', readConfig.database);

export const WriteDataSource = new DataSource(writeConfig as DataSourceOptions);
export const ReadDataSource = new DataSource(readConfig as DataSourceOptions);
export const connectionSource = WriteDataSource;

async function connectWithRetry(
  dataSource: DataSource,
  name: string,
  maxRetries = MAX_RETRIES,
  delay = 5000
) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      if (!dataSource.isInitialized) {
        console.log(`Attempting to connect to ${name} Database...`);
        console.log(`Host: ${(dataSource.options as any).host}, Database: ${(dataSource.options as any).database}`);
        
        await dataSource.initialize();
        logger.info(`${name} Database connected successfully`);
        return true;
      }
      return true;
    } catch (error) {
      retries++;
      console.error(`${name} Database connection error:`, error.message);
      logger.warn(
        {
          error: {
            message: error.message,
            code: error.code,
          },
          retries,
          maxRetries,
        },
        `Failed to connect to ${name} Database. Retrying in ${delay}ms...`
      );

      if (retries >= maxRetries) {
        logger.error(
          `Maximum retries (${maxRetries}) reached for ${name} Database`
        );
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function connect() {
  try {
    await connectWithRetry(WriteDataSource, 'Write');
    await connectWithRetry(ReadDataSource, 'Read');
  } catch (error) {
    logger.error(
      {
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code,
          detail: error.detail,
        },
      },
      'Error connecting to database'
    );
    throw error;
  }
}

export async function disconnect() {
  try {
    if (WriteDataSource.isInitialized) await WriteDataSource.destroy();
    if (ReadDataSource.isInitialized) await ReadDataSource.destroy();
    logger.info('Databases disconnected');
  } catch (error) {
    logger.error('Error disconnecting databases', error);
  }
}

process.on('SIGINT', async () => {
  await disconnect();
  process.exit(0);
});
