export type PipelineStage =
  | 'http'
  | 'credits'
  | 'download'
  | 'transcribe'
  | 'poll'
  | 'ai'
  | 'db'
  | 'fallback';

export type PipelineEvent =
  | 'started'
  | 'completed'
  | 'failed'
  | 'retry'
  | 'skipped';

export type FailureStage =
  | 'download'
  | 'transcribe'
  | 'poll'
  | 'ai'
  | 'credits'
  | 'unknown';

export type FailureCode =
  | 'VDC_DOWNLOAD_FAILED'
  | 'VDC_TRANSCRIBE_FAILED'
  | 'VDC_POLL_TIMEOUT'
  | 'VDC_SERVICE_FAILED'
  | 'SUPADATA_FAILED'
  | 'SUPADATA_JOB_FAILED'
  | 'YOUTUBE_NATIVE_FAILED'
  | 'ALL_TRANSCRIPT_PROVIDERS_FAILED'
  | 'OPENAI_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'VIDEO_INACCESSIBLE'
  | 'PROCESSING_TIMEOUT'
  | 'UNKNOWN';

export type ProcessingProvider =
  | 'videodowncut'
  | 'supadata'
  | 'youtube_native'
  | 'none';

export interface VideoPipelineContext {
  correlationId: string;
  videoId: number;
  userId: number;
  videoUrl: string;
  videoTitle?: string | null;
}

export interface FailVideoOptions {
  stage: FailureStage;
  code: FailureCode;
  message: string;
  refund?: boolean;
}
