import type { ProcessingProvider } from '../../lib/video-types';

export interface TranscriptSegment {
  time: string;
  text: string;
}

export interface TranscriptResult {
  text: string;
  provider: ProcessingProvider;
  segments?: TranscriptSegment[];
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
