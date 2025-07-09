import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './User';

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

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ type: 'jsonb', nullable: true })
  insights: any;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'downloaded' | 'transcribing' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

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
