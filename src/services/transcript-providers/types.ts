import type { ProcessingProvider } from '../../lib/video-types';

export interface TranscriptResult {
  text: string;
  provider: ProcessingProvider;
  title?: string;
  duration?: number;
  thumbnail?: string;
  externalVideoId?: string;
  downloadUrl?: string;
  transcriptionId?: string;
  supadataJobId?: string;
}

export interface TranscriptProviderAttempt {
  provider: ProcessingProvider;
  mode?: string;
}
