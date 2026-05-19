import 'dotenv/config';
import { WriteDataSource } from '../src/config/db.config';

const SQL = `
ALTER TABLE "videos"
  ADD COLUMN IF NOT EXISTS "correlationId" varchar(64),
  ADD COLUMN IF NOT EXISTS "failureStage" varchar(32),
  ADD COLUMN IF NOT EXISTS "failureCode" varchar(64),
  ADD COLUMN IF NOT EXISTS "processingProvider" varchar(32),
  ADD COLUMN IF NOT EXISTS "lastStage" varchar(32),
  ADD COLUMN IF NOT EXISTS "attemptCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "supadataJobId" varchar(64);

CREATE INDEX IF NOT EXISTS "IDX_videos_correlationId" ON "videos" ("correlationId");

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
);

CREATE INDEX IF NOT EXISTS "IDX_vpl_correlation_created"
  ON "video_processing_logs" ("correlationId", "createdAt");

CREATE INDEX IF NOT EXISTS "IDX_vpl_video_created"
  ON "video_processing_logs" ("videoId", "createdAt");
`;

async function main() {
  await WriteDataSource.initialize();
  await WriteDataSource.query(SQL);
  console.log('Observability schema applied.');
  await WriteDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
