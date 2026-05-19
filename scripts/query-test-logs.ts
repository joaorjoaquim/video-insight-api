import 'dotenv/config';
import { WriteDataSource } from '../src/config/db.config';

async function main() {
  await WriteDataSource.initialize();
  const videos = await WriteDataSource.query(
    `SELECT id, title, status, "correlationId", "failureStage", "failureCode", "processingProvider", "lastStage", "errorMessage"
     FROM videos WHERE id >= 46 ORDER BY id`
  );
  console.log('\n=== VIDEOS ===');
  console.table(videos);

  for (const v of videos) {
    const logs = await WriteDataSource.query(
      `SELECT stage, event, msg, provider, "errorCode", "durationMs", "createdAt"
       FROM video_processing_logs WHERE "videoId" = $1 ORDER BY "createdAt" ASC`,
      [v.id]
    );
    console.log(`\n--- Logs video ${v.id} (${v.correlationId}) count=${logs.length} ---`);
    logs.forEach((l: Record<string, unknown>) => {
      console.log(
        `${l.createdAt} | ${l.stage}:${l.event} | ${l.msg} | ${l.provider || '-'} | ${l.errorCode || ''}`
      );
    });
  }
  await WriteDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
