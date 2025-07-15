import { FastifyRequest, FastifyReply } from 'fastify';
import {
  getUserCredits,
  getUserTransactionHistory,
  grantCredits,
  deductCredits,
} from '../services/credit.service';

interface GetCreditsRequest {
  Querystring: {
    limit?: string;
    offset?: string;
  };
}

interface AdminCreditRequest {
  Body: {
    userId?: number;
    amount: number;
    description: string;
  };
}

// Constants for validation
const MAX_CREDIT_AMOUNT = 10000; // Prevent excessive credit grants
const MAX_PAGINATION_LIMIT = 100; // Prevent excessive data retrieval
const MIN_CREDIT_AMOUNT = 1; // Prevent zero or negative amounts

export async function getUserCreditsHandler(
  request: FastifyRequest<GetCreditsRequest>,
  reply: FastifyReply
) {
  try {
    const userId = (request.user as any)?.userId;
    const { limit, offset } = request.query;

    // Validate and sanitize pagination parameters
    const sanitizedLimit = Math.min(
      limit ? parseInt(limit) || MAX_PAGINATION_LIMIT : MAX_PAGINATION_LIMIT,
      MAX_PAGINATION_LIMIT
    );
    const sanitizedOffset = Math.max(offset ? parseInt(offset) || 0 : 0, 0);

    const credits = await getUserCredits(userId);
    const { transactions, total } = await getUserTransactionHistory(
      userId,
      sanitizedLimit,
      sanitizedOffset
    );

    return reply.send({
      credits,
      transactions,
      pagination: {
        total,
        limit: sanitizedLimit,
        offset: sanitizedOffset,
      },
    });
  } catch (error) {
    // Log error for monitoring
    request.log.error('Failed to get user credits:', error);
    return reply.status(500).send({
      message: 'Failed to retrieve credit information',
    });
  }
}

export async function grantCreditsHandler(
  request: FastifyRequest<AdminCreditRequest>,
  reply: FastifyReply
) {
  try {
    const { userId, amount, description } = request.body;
    const adminHash = request.headers['x-admin-hash'] as string;

    // Input validation
    if (!adminHash) {
      return reply.status(401).send({
        message: 'Admin hash required in X-Admin-Hash header',
        success: false,
      });
    }

    if (!amount || amount < MIN_CREDIT_AMOUNT || amount > MAX_CREDIT_AMOUNT) {
      return reply.status(400).send({
        message: `Amount must be between ${MIN_CREDIT_AMOUNT} and ${MAX_CREDIT_AMOUNT}`,
        success: false,
      });
    }

    if (!description || description.trim().length < 3) {
      return reply.status(400).send({
        message: 'Description must be at least 3 characters long',
        success: false,
      });
    }

    // Sanitize description
    const sanitizedDescription = description.trim().substring(0, 500);

    // Audit log for admin action
    request.log.info('Admin credit grant attempt', {
      adminHash: adminHash.substring(0, 8) + '...', // Log partial hash for audit
      amount,
      userId: userId || 'all_users',
      description: sanitizedDescription,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    const result = await grantCredits(
      { userId, amount, description: sanitizedDescription },
      adminHash
    );

    if (result.success) {
      // Log successful operation
      request.log.info('Admin credit grant successful', {
        amount,
        userId: userId || 'all_users',
        description: sanitizedDescription,
      });

      return reply.status(200).send({
        message: result.message,
        success: true,
      });
    } else {
      // Log failed operation
      request.log.warn('Admin credit grant failed', {
        reason: result.message,
        amount,
        userId: userId || 'all_users',
      });

      return reply.status(400).send({
        message: result.message,
        success: false,
      });
    }
  } catch (error) {
    request.log.error('Admin credit grant error:', error);
    return reply.status(500).send({
      message: 'Failed to process credit grant',
      success: false,
    });
  }
}

export async function deductCreditsHandler(
  request: FastifyRequest<AdminCreditRequest>,
  reply: FastifyReply
) {
  try {
    const { userId, amount, description } = request.body;
    const adminHash = request.headers['x-admin-hash'] as string;

    // Input validation
    if (!adminHash) {
      return reply.status(401).send({
        message: 'Admin hash required in X-Admin-Hash header',
        success: false,
      });
    }

    if (!amount || amount < MIN_CREDIT_AMOUNT || amount > MAX_CREDIT_AMOUNT) {
      return reply.status(400).send({
        message: `Amount must be between ${MIN_CREDIT_AMOUNT} and ${MAX_CREDIT_AMOUNT}`,
        success: false,
      });
    }

    if (!description || description.trim().length < 3) {
      return reply.status(400).send({
        message: 'Description must be at least 3 characters long',
        success: false,
      });
    }

    // Sanitize description
    const sanitizedDescription = description.trim().substring(0, 500);

    // Audit log for admin action
    request.log.info('Admin credit deduction attempt', {
      adminHash: adminHash.substring(0, 8) + '...', // Log partial hash for audit
      amount,
      userId: userId || 'all_users',
      description: sanitizedDescription,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    const result = await deductCredits(
      { userId, amount, description: sanitizedDescription },
      adminHash
    );

    if (result.success) {
      // Log successful operation
      request.log.info('Admin credit deduction successful', {
        amount,
        userId: userId || 'all_users',
        description: sanitizedDescription,
      });

      return reply.status(200).send({
        message: result.message,
        success: true,
      });
    } else {
      // Log failed operation
      request.log.warn('Admin credit deduction failed', {
        reason: result.message,
        amount,
        userId: userId || 'all_users',
      });

      return reply.status(400).send({
        message: result.message,
        success: false,
      });
    }
  } catch (error) {
    request.log.error('Admin credit deduction error:', error);
    return reply.status(500).send({
      message: 'Failed to process credit deduction',
      success: false,
    });
  }
}
