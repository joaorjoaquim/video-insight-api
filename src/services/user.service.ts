import { UserRepository } from '../repositories/user.repository';
import { UserEntity } from '../entities/User';
import bcrypt from 'bcrypt';

export async function createUser(
  userData: Partial<UserEntity>
): Promise<Partial<UserEntity>> {
  if (userData.password) {
    const saltRounds = 10;
    userData.password = await bcrypt.hash(userData.password, saltRounds);
  }

  const user = UserRepository.create(userData);
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
