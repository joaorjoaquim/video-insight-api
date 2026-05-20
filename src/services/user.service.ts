import { randomBytes } from 'crypto';
import { UserRepository } from '../repositories/user.repository';
import { UserEntity } from '../entities/User';
import bcrypt from 'bcrypt';
import logger from '../config/logger';

function generateReferralCode(): string {
  return randomBytes(4).toString('hex');
}

export async function createUser(
  userData: Partial<UserEntity>
): Promise<Partial<UserEntity>> {
  if (userData.password) {
    userData.password = await bcrypt.hash(userData.password, 10);
  }

  const referralCode = generateReferralCode();
  const user = UserRepository.create({
    ...userData,
    credits: 100,
    referralCode,
  });

  const savedUser = await UserRepository.save(user);
  logger.info({ userId: savedUser.id, referralCode }, 'user_created');

  const { password, ...userWithoutPassword } = savedUser;
  return userWithoutPassword;
}

export async function createOrUpdateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
  avatarUrl?: string,
  githubUsername?: string,
  githubId?: string
): Promise<Partial<UserEntity>> {
  let user = await UserRepository.findOne({ where: { providerId, provider } });

  if (!user) {
    user = await UserRepository.findOne({ where: { email } });

    if (user) {
      user.provider = provider;
      user.providerId = providerId;
      user.avatarUrl = avatarUrl;
      user.name = name;
      if (githubUsername) user.githubUsername = githubUsername;
      if (githubId) user.githubId = githubId;
      if (!user.referralCode) user.referralCode = generateReferralCode();
    } else {
      user = UserRepository.create({
        email,
        name,
        avatarUrl,
        provider,
        providerId,
        password: null,
        credits: 100,
        referralCode: generateReferralCode(),
        githubUsername: githubUsername || null,
        githubId: githubId || null,
      });
    }
  } else {
    user.name = name;
    user.avatarUrl = avatarUrl;
    if (githubUsername) user.githubUsername = githubUsername;
    if (githubId) user.githubId = githubId;
    if (!user.referralCode) user.referralCode = generateReferralCode();
  }

  const savedUser = await UserRepository.save(user);
  logger.info({ userId: savedUser.id, provider }, 'oauth_user_upserted');

  const { password, ...userWithoutPassword } = savedUser;
  return userWithoutPassword;
}

export async function getUserById(
  id: number
): Promise<Partial<UserEntity> | null> {
  const user = await UserRepository.findOne({ where: { id } });

  if (!user) {
    return null;
  }

  const { password, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export async function getUserByEmail(
  email: string
): Promise<UserEntity | null> {
  return await UserRepository.findOne({ where: { email } });
}

export async function validatePassword(
  user: UserEntity,
  password: string
): Promise<boolean> {
  return await bcrypt.compare(password, user.password);
}

export async function findUserByReferralCode(
  code: string
): Promise<UserEntity | null> {
  return UserRepository.findOne({ where: { referralCode: code } });
}

export async function ensureReferralCode(userId: number): Promise<string> {
  const user = await UserRepository.findOne({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  if (user.referralCode) return user.referralCode;

  const code = generateReferralCode();
  await UserRepository.update(userId, { referralCode: code });
  logger.info({ userId, referralCode: code }, 'referral_code_generated');
  return code;
}

export async function countReferrals(referralCode: string): Promise<number> {
  return UserRepository.count({ where: { referredByCode: referralCode } });
}
