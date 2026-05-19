-- Video Insight API — baseline failure analysis (run in Neon SQL editor)

-- Recent failures with pipeline context
SELECT
  id,
  title,
  status,
  "failureStage",
  "failureCode",
  "errorMessage",
  "correlationId",
  "processingProvider",
  "lastStage",
  "attemptCount",
  "videoUrl",
  "videoId" AS external_video_id,
  "transcriptionId",
  length(transcription) AS transcript_chars,
  "tokensUsed",
  "createdAt",
  "updatedAt"
FROM videos
WHERE status = 'failed'
ORDER BY "updatedAt" DESC
LIMIT 50;

-- Stuck videos (not failed but pipeline stopped)
SELECT status, count(*) AS cnt
FROM videos
WHERE status NOT IN ('completed', 'failed')
GROUP BY status
ORDER BY cnt DESC;

-- Failure breakdown by stage (after migration)
SELECT "failureStage", "failureCode", count(*) AS cnt
FROM videos
WHERE status = 'failed'
GROUP BY "failureStage", "failureCode"
ORDER BY cnt DESC;

-- Trace by title (after video_processing_logs exists)
-- SELECT correlation_id FROM video_processing_logs
-- WHERE video_title ILIKE '%search term%' ORDER BY created_at DESC LIMIT 1;

-- SELECT stage, event, msg, provider, duration_ms, error_code, created_at
-- FROM video_processing_logs
-- WHERE correlation_id = 'vid_...'
-- ORDER BY created_at ASC;
