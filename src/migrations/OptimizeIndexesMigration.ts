import { MigrationInterface, QueryRunner } from 'typeorm';

export class OptimizeIndexesMigration1710000000002
  implements MigrationInterface
{
  name = 'OptimizeIndexesMigration1710000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add indexes for better performance on common queries

    // Index for videos by userId (for listing user's videos)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_userId" ON "videos" ("userId")
    `);

    // Index for videos by status (for filtering by status)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_status" ON "videos" ("status")
    `);

    // Composite index for videos by userId and status (for filtering user's videos by status)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_userId_status" ON "videos" ("userId", "status")
    `);

    // Index for videos by createdAt (for ordering by date)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_createdAt" ON "videos" ("createdAt" DESC)
    `);

    // Composite index for videos by userId and createdAt (for ordering user's videos by date)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_userId_createdAt" ON "videos" ("userId", "createdAt" DESC)
    `);

    // Index for videos by videoId (external service ID)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_videoId" ON "videos" ("videoId")
    `);

    // Index for videos by transcriptionId (external service ID)
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_transcriptionId" ON "videos" ("transcriptionId")
    `);

    // Index for users by email (already exists as unique, but good to have explicit)
    await queryRunner.query(`
      CREATE INDEX "IDX_users_email" ON "users" ("email")
    `);

    // Index for users by provider and providerId (for OAuth lookups)
    await queryRunner.query(`
      CREATE INDEX "IDX_users_provider_providerId" ON "users" ("provider", "providerId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove all created indexes
    await queryRunner.query(`DROP INDEX "IDX_videos_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_userId_status"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_videoId"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_transcriptionId"`);
    await queryRunner.query(`DROP INDEX "IDX_users_email"`);
    await queryRunner.query(`DROP INDEX "IDX_users_provider_providerId"`);
  }
}
