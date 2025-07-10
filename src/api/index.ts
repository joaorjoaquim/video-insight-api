import { buildServer } from '../server';
import { connect } from '../config/db.config';

// Set environment variables for Vercel
if (process.env.VERCEL) {
  process.env.NODE_ENV = 'production';
  // Ensure we don't use pino-pretty in serverless
  process.env.VERCEL_ENV = 'production';
}

console.log('API handler initialized with NODE_ENV:', process.env.NODE_ENV);
console.log('VERCEL environment:', process.env.VERCEL);

let app: any = null;
let isConnected = false;

export default async function handler(req: any, res: any) {
  console.log('Request received:', req.method, req.url);
  
  // Add CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!app) {
    try {
      console.log('Building server...');
      app = buildServer();
      console.log('Server built successfully');
    } catch (error) {
      console.error('Failed to build server:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (!isConnected) {
    try {
      console.log('Connecting to database...');
      await connect();
      isConnected = true;
      console.log('Database connection established');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      // Continue without database connection for now
    }
  }

  try {
    console.log('Preparing server...');
    await app.ready();
    console.log('Server ready, handling request');
    app.server.emit('request', req, res);
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
