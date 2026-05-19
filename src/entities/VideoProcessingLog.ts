import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { VideoEntity } from './Video';

@Entity('video_processing_logs')
@Index(['correlationId', 'createdAt'])
@Index(['videoId', 'createdAt'])
export class VideoProcessingLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  correlationId: string;

  @Column({ type: 'int' })
  videoId: number;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'text', nullable: true })
  videoTitle: string | null;

  @Column({ type: 'text', nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', length: 32 })
  stage: string;

  @Column({ type: 'varchar', length: 32 })
  event: string;

  @Column({ type: 'varchar', length: 255 })
  msg: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  externalRequestId: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ type: 'int', default: 1 })
  attempt: number;

  @Column({ type: 'jsonb', nullable: true })
  inputSummary: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  outputSummary: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @ManyToOne(() => VideoEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: VideoEntity;

  @CreateDateColumn()
  createdAt: Date;
}
