import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoIdToCreditTransactions1753883000000
  implements MigrationInterface
{
  name = 'AddVideoIdToCreditTransactions1753883000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add videoId column
    await queryRunner.query(`
      ALTER TABLE "credit_transactions"
      ADD COLUMN "videoId" integer
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "credit_transactions"
      ADD CONSTRAINT "FK_credit_transactions_video"
      FOREIGN KEY ("videoId") REFERENCES "videos"("id")
      ON DELETE SET NULL
    `);

    // Update existing video-related transactions to set videoId
    await queryRunner.query(`
      UPDATE "credit_transactions"
      SET "videoId" = CAST("referenceId" AS integer)
      WHERE "referenceType" LIKE '%video%'
      AND "referenceId" IS NOT NULL
      AND "referenceId" ~ '^[0-9]+$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "credit_transactions"
      DROP CONSTRAINT "FK_credit_transactions_video"
    `);

    // Remove videoId column
    await queryRunner.query(`
      ALTER TABLE "credit_transactions"
      DROP COLUMN "videoId"
    `);
  }
}
