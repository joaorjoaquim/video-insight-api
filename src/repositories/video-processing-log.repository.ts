import { connectionSource } from '../config/db.config';
import { VideoProcessingLogEntity } from '../entities/VideoProcessingLog';

export const VideoProcessingLogRepository =
  connectionSource.getRepository(VideoProcessingLogEntity);
