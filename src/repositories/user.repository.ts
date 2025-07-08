import { connectionSource } from '../config/db.config';
import { UserEntity } from '../entities/User';

export const UserRepository = connectionSource.getRepository(UserEntity);
