import { buildServer } from '../server';
import { connect } from '../config/db.config';
import pino from 'pino';

const log = pino({ level: 'info' });

if (process.env.VERCEL) {
  process.env.NODE_ENV = 'production';
}

let app: any = null;
let isConnected = false;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!app) {
    try {
      app = buildServer();
    } catch (error) {
      log.error({ error }, 'server_build_failed');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (!isConnected) {
    try {
      await connect();
      isConnected = true;
    } catch (error) {
      log.error({ error }, 'database_connection_failed');
    }
  }

  try {
    await app.ready();
    app.server.emit('request', req, res);
  } catch (error) {
    log.error({ error }, 'server_request_failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
}
