import { connectionSource } from '../config/db.config';
import { PromoCodeEntity } from '../entities/PromoCode';

export const PromoCodeRepository = connectionSource.getRepository(PromoCodeEntity);
