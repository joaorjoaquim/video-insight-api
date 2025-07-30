import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from './User';
import { VideoEntity } from './Video';

export enum TransactionType {
  PURCHASE = 'purchase',
  SPEND = 'spend',
  REFUND = 'refund',
  ADMIN_GRANT = 'admin_grant',
  ADMIN_DEDUCT = 'admin_deduct',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('credit_transactions')
export class CreditTransactionEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int' })
  amount: number; // Positive for credits added, negative for credits spent

  @Column({ type: 'text' })
  type: TransactionType;

  @Column({ type: 'text', default: TransactionStatus.COMPLETED })
  status: TransactionStatus;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  referenceId: string; // For video submissions, purchase IDs, etc.

  @Column({ type: 'text', nullable: true })
  referenceType: string; // 'video_submission', 'purchase', 'admin_action', etc.

  @Column({ type: 'int', nullable: true })
  tokensUsed: number; // For video processing

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'int' })
  userId: number;

  // Add relation to Video entity
  @ManyToOne(() => VideoEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'videoId' })
  video: VideoEntity;

  @Column({ type: 'int', nullable: true })
  videoId: number;

  @CreateDateColumn()
  createdAt: Date;

  constructor() {
    if (!this.id) {
      this.id = 0;
    }
  }
}
