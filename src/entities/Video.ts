import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from './User';

@Index(['userId', 'createdAt'])
@Index(['userId', 'status'])
@Entity('videos')
export class VideoEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'text' })
  videoUrl: string;

  @Column({ type: 'text', nullable: true })
  videoId: string;

  @Column({ type: 'text', nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  thumbnail: string;

  @Column({ type: 'float', nullable: true })
  duration: number;

  @Column({ type: 'text', nullable: true })
  downloadUrl: string;

  @Column({ type: 'text', nullable: true })
  transcriptionId: string;

  @Column({ type: 'text', nullable: true })
  transcription: string;

  @Column({ type: 'jsonb', nullable: true })
  dashboard?: any;

  @Column({ type: 'int', nullable: true })
  tokensUsed?: number;

  @Column({ type: 'int', nullable: true })
  creditsCost?: number;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'downloaded' | 'transcribing' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  correlationId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  failureStage: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  processingProvider: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  lastStage: string | null;

  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  supadataJobId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'int' })
  userId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  constructor() {
    if (!this.id) {
      this.id = 0;
    }
  }
}
