import { WriteDataSource } from '../config/db.config';
import { UserRepository } from '../repositories/user.repository';
import { UserEntity } from '../entities/User';
import { grantCreditsInternal } from './credit.service';
import { expirePromoCodes } from './promo.service';
import logger from '../config/logger';

export const WEEKLY_CREDIT_FLOOR = parseInt(process.env.WEEKLY_CREDIT_FLOOR || '100', 10);

export async function runExpirePromoCodes(): Promise<{ expired: number }> {
  logger.info('cron_expire_promo_codes_start');
  try {
    const expired = await expirePromoCodes();
    logger.info({ expired }, 'cron_expire_promo_codes_done');
    return { expired };
  } catch (err) {
    logger.error({ err }, 'cron_expire_promo_codes_error');
    throw err;
  }
}

export async function runWeeklyCreditRestore(): Promise<{ usersRestored: number; creditsGranted: number }> {
  logger.info({ floor: WEEKLY_CREDIT_FLOOR }, 'cron_weekly_credit_restore_start');

  try {
    const users = await UserRepository.find();
    let usersRestored = 0;
    let creditsGranted = 0;

    for (const user of users) {
      if (user.credits < WEEKLY_CREDIT_FLOOR) {
        const topUp = WEEKLY_CREDIT_FLOOR - user.credits;
        await grantCreditsInternal(
          user.id,
          topUp,
          `Weekly credit restore (floor: ${WEEKLY_CREDIT_FLOOR})`,
          'weekly_restore'
        );
        usersRestored++;
        creditsGranted += topUp;
      }
    }

    logger.info({ usersRestored, creditsGranted, floor: WEEKLY_CREDIT_FLOOR }, 'cron_weekly_credit_restore_done');
    return { usersRestored, creditsGranted };
  } catch (err) {
    logger.error({ err }, 'cron_weekly_credit_restore_error');
    throw err;
  }
}
