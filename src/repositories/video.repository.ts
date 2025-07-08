import { connectionSource } from '../config/db.config';
import { VideoEntity } from '../entities/Video';

export const VideoRepository = connectionSource.getRepository(VideoEntity);
