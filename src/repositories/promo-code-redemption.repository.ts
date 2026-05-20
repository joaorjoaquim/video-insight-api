import { connectionSource } from '../config/db.config';
import { PromoCodeRedemptionEntity } from '../entities/PromoCodeRedemption';

export const PromoCodeRedemptionRepository = connectionSource.getRepository(PromoCodeRedemptionEntity);
