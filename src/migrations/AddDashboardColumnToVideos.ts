import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDashboardColumnToVideos1710000000001 implements MigrationInterface {
  name = 'AddDashboardColumnToVideos1710000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" ADD COLUMN "dashboard" jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP COLUMN "dashboard"`
    );
  }
} 