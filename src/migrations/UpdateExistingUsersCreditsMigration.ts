import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateExistingUsersCreditsMigration1710000000003 implements MigrationInterface {
  name = 'UpdateExistingUsersCreditsMigration1710000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update existing users who have 0 credits to have 100 credits
    await queryRunner.query(`
      UPDATE "users" 
      SET "credits" = 100 
      WHERE "credits" = 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert: set users back to 0 credits (only if they were originally 0)
    // Note: This is a simplified revert - in practice, you'd need to track which users were updated
    await queryRunner.query(`
      UPDATE "users" 
      SET "credits" = 0 
      WHERE "credits" = 100
    `);
  }
} 