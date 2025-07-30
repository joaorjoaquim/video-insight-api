import { CreditTransactionRepository } from '../repositories/credit-transaction.repository';
import { UserRepository } from '../repositories/user.repository';
import {
  CreditTransactionEntity,
  TransactionType,
  TransactionStatus,
} from '../entities/CreditTransaction';
import { UserEntity } from '../entities/User';
import { VideoEntity } from '../entities/Video';

// Enhanced transaction interface with video information
export interface TransactionWithVideoInfo {
  id: number;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  referenceId?: string;
  referenceType?: string;
  tokensUsed?: number;
  userId: number;
  videoId?: number;
  createdAt: Date;
  video?: {
    id: number;
    title: string;
    duration: number;
    status: string;
  } | null;
}

export interface CreditSpendRequest {
  userId: number;
  amount: number;
  description: string;
  referenceId?: string;
  referenceType?: string;
  tokensUsed?: number;
  videoId?: number; // Add videoId to the request
}

export interface CreditRefundRequest {
  userId: number;
  amount: number;
  description: string;
  referenceId?: string;
  referenceType?: string;
  videoId?: number; // Add videoId to the request
}

export interface AdminCreditRequest {
  userId?: number; // If null, applies to all users
  amount: number;
  description: string;
}

export interface AdminCreditRequestWithAuth extends AdminCreditRequest {
  adminHash: string;
}

export async function getUserCredits(userId: number): Promise<number> {
  const user = await UserRepository.findOne({ where: { id: userId } });
  return user?.credits || 0;
}

export async function getUserTransactionHistory(
  userId: number,
  limit?: number,
  offset?: number
): Promise<{ transactions: TransactionWithVideoInfo[]; total: number }> {
  const queryBuilder = CreditTransactionRepository.createQueryBuilder(
    'transaction'
  )
    .leftJoinAndSelect('transaction.user', 'user')
    .leftJoinAndSelect('transaction.video', 'video')
    .where('transaction.userId = :userId', { userId })
    .orderBy('transaction.createdAt', 'DESC');

  if (limit) {
    queryBuilder.limit(limit);
  }

  if (offset) {
    queryBuilder.offset(offset);
  }

  const transactions = await queryBuilder.getMany();
  const total = await CreditTransactionRepository.count({ where: { userId } });

  // Transform to include video info in the expected format
  const enhancedTransactions: TransactionWithVideoInfo[] = transactions.map(
    (transaction) => {
      const enhancedTransaction: TransactionWithVideoInfo = { ...transaction };

      if (transaction.video) {
        enhancedTransaction.video = {
          id: transaction.video.id,
          title: transaction.video.title || 'Untitled Video',
          duration: transaction.video.duration || 0,
          status: transaction.video.status,
        };
      }

      return enhancedTransaction;
    }
  );

  return {
    transactions: enhancedTransactions,
    total,
  };
}

export async function spendCredits(
  request: CreditSpendRequest
): Promise<boolean> {
  const {
    userId,
    amount,
    description,
    referenceId,
    referenceType,
    tokensUsed,
    videoId,
  } = request;

  // Check if user has enough credits
  const user = await UserRepository.findOne({ where: { id: userId } });
  if (!user || user.credits < amount) {
    return false;
  }

  // Create transaction record with video relation
  const transaction = CreditTransactionRepository.create({
    userId,
    amount: -amount, // Negative for spending
    type: TransactionType.SPEND,
    status: TransactionStatus.COMPLETED,
    description,
    referenceId,
    referenceType,
    tokensUsed,
    videoId, // Add videoId to the transaction
  });

  await CreditTransactionRepository.save(transaction);

  // Update user credits
  await UserRepository.update(userId, {
    credits: user.credits - amount,
  });

  return true;
}

export async function refundCredits(
  request: CreditRefundRequest
): Promise<boolean> {
  const { userId, amount, description, referenceId, referenceType, videoId } =
    request;

  // Create refund transaction with video relation
  const transaction = CreditTransactionRepository.create({
    userId,
    amount: amount, // Positive for refund
    type: TransactionType.REFUND,
    status: TransactionStatus.COMPLETED,
    description,
    referenceId,
    referenceType,
    videoId, // Add videoId to the transaction
  });

  await CreditTransactionRepository.save(transaction);

  // Update user credits
  const user = await UserRepository.findOne({ where: { id: userId } });
  if (user) {
    await UserRepository.update(userId, {
      credits: user.credits + amount,
    });
  }

  return true;
}

export async function grantCredits(
  request: AdminCreditRequest,
  adminHash: string
): Promise<{ success: boolean; message: string }> {
  const { userId, amount, description } = request;

  // Verify admin hash
  const expectedHash = process.env.ADMIN_CREDIT_HASH;
  if (!expectedHash || adminHash !== expectedHash) {
    return { success: false, message: 'Invalid admin hash' };
  }

  if (userId) {
    // Grant credits to specific user
    const user = await UserRepository.findOne({ where: { id: userId } });
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const transaction = CreditTransactionRepository.create({
      userId,
      amount,
      type: TransactionType.ADMIN_GRANT,
      status: TransactionStatus.COMPLETED,
      description,
      referenceType: 'admin_action',
    });

    await CreditTransactionRepository.save(transaction);
    await UserRepository.update(userId, { credits: user.credits + amount });

    return {
      success: true,
      message: `Granted ${amount} credits to user ${userId}`,
    };
  } else {
    // Grant credits to all users
    const users = await UserRepository.find();
    const transactions = users.map((user) =>
      CreditTransactionRepository.create({
        userId: user.id,
        amount,
        type: TransactionType.ADMIN_GRANT,
        status: TransactionStatus.COMPLETED,
        description,
        referenceType: 'admin_action',
      })
    );

    await CreditTransactionRepository.save(transactions);

    // Update all users
    for (const user of users) {
      await UserRepository.update(user.id, { credits: user.credits + amount });
    }

    return {
      success: true,
      message: `Granted ${amount} credits to all ${users.length} users`,
    };
  }
}

export async function deductCredits(
  request: AdminCreditRequest,
  adminHash: string
): Promise<{ success: boolean; message: string }> {
  const { userId, amount, description } = request;

  // Verify admin hash
  const expectedHash = process.env.ADMIN_CREDIT_HASH;
  if (!expectedHash || adminHash !== expectedHash) {
    return { success: false, message: 'Invalid admin hash' };
  }

  if (userId) {
    // Deduct credits from specific user
    const user = await UserRepository.findOne({ where: { id: userId } });
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.credits < amount) {
      return { success: false, message: 'User does not have enough credits' };
    }

    const transaction = CreditTransactionRepository.create({
      userId,
      amount: -amount,
      type: TransactionType.ADMIN_DEDUCT,
      status: TransactionStatus.COMPLETED,
      description,
      referenceType: 'admin_action',
    });

    await CreditTransactionRepository.save(transaction);
    await UserRepository.update(userId, { credits: user.credits - amount });

    return {
      success: true,
      message: `Deducted ${amount} credits from user ${userId}`,
    };
  } else {
    // Deduct credits from all users
    const users = await UserRepository.find();
    const validUsers = users.filter((user) => user.credits >= amount);

    if (validUsers.length === 0) {
      return {
        success: false,
        message: 'No users have enough credits to deduct',
      };
    }

    const transactions = validUsers.map((user) =>
      CreditTransactionRepository.create({
        userId: user.id,
        amount: -amount,
        type: TransactionType.ADMIN_DEDUCT,
        status: TransactionStatus.COMPLETED,
        description,
        referenceType: 'admin_action',
      })
    );

    await CreditTransactionRepository.save(transactions);

    // Update valid users
    for (const user of validUsers) {
      await UserRepository.update(user.id, { credits: user.credits - amount });
    }

    return {
      success: true,
      message: `Deducted ${amount} credits from ${validUsers.length} users`,
    };
  }
}
