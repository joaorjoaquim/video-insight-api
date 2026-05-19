import app from './server';
import dotenv from 'dotenv';
import { connect } from './config/db.config';
import pino from 'pino';

dotenv.config();

const logger = pino();

async function startServer() {
    try {
        const port = Number(process.env.PORT) || 3000;
        await app.ready();
        await app.listen({ port, host: '0.0.0.0' });
        logger.info(`Server is running locally on port ${port}`);
    } catch (error) {
        logger.error(
            { err: error },
            error instanceof Error ? error.message : 'Error starting application'
        );
        process.exit(1);
    }
}

startServer();
