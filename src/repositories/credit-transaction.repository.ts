import { connectionSource } from '../config/db.config';
import { CreditTransactionEntity } from '../entities/CreditTransaction';

export const CreditTransactionRepository = connectionSource.getRepository(CreditTransactionEntity); 