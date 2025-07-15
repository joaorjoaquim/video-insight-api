import { UserRepository } from '../repositories/user.repository';
import { UserEntity } from '../entities/User';
import bcrypt from 'bcrypt';

export async function createUser(
  userData: Partial<UserEntity>
): Promise<Partial<UserEntity>> {
  // Hash password only if provided (OAuth users don't have passwords)
  if (userData.password) {
    const saltRounds = 10;
    userData.password = await bcrypt.hash(userData.password, saltRounds);
  }

  // Set default credits for new users
  const userWithDefaults = {
    ...userData,
    credits: 100, // Default balance for new users
  };

  const user = UserRepository.create(userWithDefaults);
  const savedUser = await UserRepository.save(user);

  const { password, ...userWithoutPassword } = savedUser;
  return userWithoutPassword;
}

export async function createOrUpdateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
  avatarUrl?: string
): Promise<Partial<UserEntity>> {
  // Check if user exists by providerId
  let user = await UserRepository.findOne({
    where: { providerId, provider },
  });

  if (!user) {
    // Check if user exists by email
    user = await UserRepository.findOne({
      where: { email },
    });

    if (user) {
      // Update existing user with OAuth info
      user.provider = provider;
      user.providerId = providerId;
      user.avatarUrl = avatarUrl;
      user.name = name; // Update name from OAuth
    } else {
      // Create new OAuth user with default credits
      user = UserRepository.create({
        email,
        name,
        avatarUrl,
        provider,
        providerId,
        password: null, // OAuth users don't have passwords
        credits: 100, // Default balance for new OAuth users
      });
    }
  } else {
    // Update existing OAuth user
    user.name = name;
    user.avatarUrl = avatarUrl;
  }

  const savedUser = await UserRepository.save(user);
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
