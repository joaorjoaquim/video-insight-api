/**
 * Public API for video processing — re-exports pipeline + AI modules.
 */
export {
  createVideo,
  createVideoWithCredits,
  getVideoById,
  getVideosByUserId,
  getVideosCountByUserId,
  updateVideo,
  startVideoDownload,
  startTranscription,
  checkTranscriptionStatus,
  processVideo,
  getFailedVideos,
} from './video-pipeline.service';

export {
  formatRawTranscription,
  calculateCreditsFromTokens,
  generateAIInsights,
} from './video-ai.service';

export { getVideoTrace } from '../lib/log-video-event';
