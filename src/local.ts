import app from './server';
import dotenv from 'dotenv';
import { connect } from './config/db.config';
import pino from 'pino';
import cron from 'node-cron';
import { runExpirePromoCodes, runWeeklyCreditRestore } from './services/cron.service';

dotenv.config();

const logger = pino();

function startCronJobs() {
  // Every minute: expire promo codes whose expiresAt has passed
  cron.schedule('* * * * *', async () => {
    try {
      await runExpirePromoCodes();
    } catch (err) {
      logger.error({ err }, 'cron_expire_promos_unhandled_error');
    }
  });

  // Every Sunday at midnight UTC: restore credits to minimum floor
  cron.schedule('0 0 * * 0', async () => {
    try {
      await runWeeklyCreditRestore();
    } catch (err) {
      logger.error({ err }, 'cron_weekly_restore_unhandled_error');
    }
  });

  logger.info('Cron jobs started: expire-promos (every minute), weekly-credit-restore (Sunday midnight)');
}

async function startServer() {
  try {
    const port = Number(process.env.PORT) || 3000;
    await app.ready();
    await app.listen({ port, host: '0.0.0.0' });
    logger.info(`Server is running locally on port ${port}`);
    startCronJobs();
  } catch (error) {
    logger.error(
      { err: error },
      error instanceof Error ? error.message : 'Error starting application'
    );
    process.exit(1);
  }
}

startServer();
