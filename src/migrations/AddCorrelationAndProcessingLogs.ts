import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCorrelationAndProcessingLogs1710000000010
  implements MigrationInterface
{
  name = 'AddCorrelationAndProcessingLogs1710000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "videos"
      ADD COLUMN IF NOT EXISTS "correlationId" varchar(64),
      ADD COLUMN IF NOT EXISTS "failureStage" varchar(32),
      ADD COLUMN IF NOT EXISTS "failureCode" varchar(64),
      ADD COLUMN IF NOT EXISTS "processingProvider" varchar(32),
      ADD COLUMN IF NOT EXISTS "lastStage" varchar(32),
      ADD COLUMN IF NOT EXISTS "attemptCount" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "supadataJobId" varchar(64)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_videos_correlationId"
      ON "videos" ("correlationId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "video_processing_logs" (
        "id" BIGSERIAL NOT NULL,
        "correlationId" varchar(64) NOT NULL,
        "videoId" integer NOT NULL,
        "userId" integer,
        "videoTitle" text,
        "videoUrl" text,
        "stage" varchar(32) NOT NULL,
        "event" varchar(32) NOT NULL,
        "msg" varchar(255) NOT NULL,
        "provider" varchar(32),
        "externalRequestId" varchar(64),
        "durationMs" integer,
        "httpStatus" integer,
        "attempt" integer NOT NULL DEFAULT 1,
        "inputSummary" jsonb,
        "outputSummary" jsonb,
        "errorCode" varchar(64),
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_video_processing_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_video_processing_logs_video"
          FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vpl_correlation_created"
      ON "video_processing_logs" ("correlationId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vpl_video_created"
      ON "video_processing_logs" ("videoId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "video_processing_logs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_videos_correlationId"`);
    await queryRunner.query(`
      ALTER TABLE "videos"
      DROP COLUMN IF EXISTS "correlationId",
      DROP COLUMN IF EXISTS "failureStage",
      DROP COLUMN IF EXISTS "failureCode",
      DROP COLUMN IF EXISTS "processingProvider",
      DROP COLUMN IF EXISTS "lastStage",
      DROP COLUMN IF EXISTS "attemptCount",
      DROP COLUMN IF EXISTS "supadataJobId"
    `);
  }
}
