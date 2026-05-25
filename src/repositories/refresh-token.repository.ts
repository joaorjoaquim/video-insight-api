import { connectionSource } from '../config/db.config';
import { RefreshTokenEntity } from '../entities/RefreshToken';

export const RefreshTokenRepository = connectionSource.getRepository(RefreshTokenEntity);
