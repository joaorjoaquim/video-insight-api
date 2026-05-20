import { WriteDataSource } from '../config/db.config';
import { PromoCodeRepository } from '../repositories/promo-code.repository';
import { PromoCodeRedemptionRepository } from '../repositories/promo-code-redemption.repository';
import { PromoCodeEntity } from '../entities/PromoCode';
import { PromoCodeRedemptionEntity } from '../entities/PromoCodeRedemption';
import { grantCreditsInternal } from './credit.service';
import { UserRepository } from '../repositories/user.repository';
import logger from '../config/logger';

export interface CreatePromoCodeInput {
  code: string;
  credits: number;
  maxUses?: number | null;
  expiresAt?: Date | null;
  description?: string | null;
}

export interface RedeemResult {
  success: boolean;
  credits?: number;
  coinsAdded?: number;
  message: string;
  statusCode: number;
}

export async function createPromoCode(input: CreatePromoCodeInput): Promise<PromoCodeEntity> {
  const code = input.code.trim().toUpperCase();

  const existing = await PromoCodeRepository.findOne({ where: { code } });
  if (existing) {
    throw Object.assign(new Error('Promo code already exists'), { statusCode: 409 });
  }

  const promo = PromoCodeRepository.create({
    code,
    credits: input.credits,
    maxUses: input.maxUses ?? null,
    expiresAt: input.expiresAt ?? null,
    description: input.description ?? null,
    isActive: true,
    usedCount: 0,
  });

  const saved = await PromoCodeRepository.save(promo);
  logger.info({ promoId: saved.id, code: saved.code, credits: saved.credits }, 'promo_code_created');
  return saved;
}

export async function listPromoCodes(): Promise<{ promoCodes: PromoCodeEntity[]; total: number }> {
  const [promoCodes, total] = await PromoCodeRepository.findAndCount({
    order: { createdAt: 'DESC' },
  });
  return { promoCodes, total };
}

export async function redeemPromoCode(userId: number, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();

  const promo = await PromoCodeRepository.findOne({ where: { code } });

  if (!promo) {
    logger.warn({ userId, code }, 'promo_redeem_not_found');
    return { success: false, message: 'Promo code not found or invalid', statusCode: 400 };
  }

  if (!promo.isActive) {
    logger.warn({ userId, code, promoId: promo.id }, 'promo_redeem_inactive');
    return { success: false, message: 'Promo code is no longer active', statusCode: 400 };
  }

  if (promo.expiresAt && promo.expiresAt < new Date()) {
    logger.warn({ userId, code, promoId: promo.id }, 'promo_redeem_expired');
    return { success: false, message: 'Promo code has expired', statusCode: 400 };
  }

  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    logger.warn({ userId, code, promoId: promo.id }, 'promo_redeem_exhausted');
    return { success: false, message: 'Promo code has reached its usage limit', statusCode: 400 };
  }

  const existingRedemption = await PromoCodeRedemptionRepository.findOne({
    where: { userId, promoCodeId: promo.id },
  });

  if (existingRedemption) {
    logger.warn({ userId, code, promoId: promo.id }, 'promo_redeem_already_used');
    return { success: false, message: 'You have already redeemed this promo code', statusCode: 409 };
  }

  const queryRunner = WriteDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const redemption = queryRunner.manager.create(PromoCodeRedemptionEntity, {
      userId,
      promoCodeId: promo.id,
    });
    await queryRunner.manager.save(redemption);

    await queryRunner.manager.increment(PromoCodeEntity, { id: promo.id }, 'usedCount', 1);

    await queryRunner.commitTransaction();
  } catch (err) {
    await queryRunner.rollbackTransaction();
    logger.error({ err, userId, code }, 'promo_redeem_transaction_failed');
    throw err;
  } finally {
    await queryRunner.release();
  }

  await grantCreditsInternal(
    userId,
    promo.credits,
    `Promo code: ${code}`,
    'promo_code',
    code
  );

  const user = await UserRepository.findOne({ where: { id: userId } });

  logger.info({ userId, code, promoId: promo.id, credits: promo.credits }, 'promo_redeem_success');

  return {
    success: true,
    credits: user?.credits ?? 0,
    coinsAdded: promo.credits,
    message: `Promo code redeemed successfully! You received ${promo.credits} credits.`,
    statusCode: 200,
  };
}

export async function expirePromoCodes(): Promise<number> {
  const result = await PromoCodeRepository.createQueryBuilder()
    .update(PromoCodeEntity)
    .set({ isActive: false })
    .where('isActive = :active', { active: true })
    .andWhere('expiresAt IS NOT NULL')
    .andWhere('expiresAt < :now', { now: new Date() })
    .execute();

  const count = result.affected ?? 0;
  if (count > 0) {
    logger.info({ count }, 'promo_codes_expired');
  }
  return count;
}
