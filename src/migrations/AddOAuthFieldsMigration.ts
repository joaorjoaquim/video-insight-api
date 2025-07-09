import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOAuthFieldsMigration1710000000001
  implements MigrationInterface
{
  name = 'AddOAuthFieldsMigration1710000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add OAuth fields to users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "avatarUrl" character varying,
      ADD COLUMN "provider" character varying,
      ADD COLUMN "providerId" character varying
    `);

    // Make password nullable for OAuth users
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "password" DROP NOT NULL
    `);

    // Add index for providerId for faster lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_users_providerId" ON "users" ("providerId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index
    await queryRunner.query(`DROP INDEX "IDX_users_providerId"`);

    // Remove OAuth columns
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "avatarUrl",
      DROP COLUMN "provider",
      DROP COLUMN "providerId"
    `);

    // Make password required again
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "password" SET NOT NULL
    `);
  }
}
