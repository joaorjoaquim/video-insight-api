import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { VideoEntity } from './Video';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  password: string;

  @Column({ type: 'int', default: 100 })
  credits: number;

  @Column({ type: 'text', nullable: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string;

  @Column({ type: 'text', nullable: true })
  provider: string;

  @Column({ type: 'text', nullable: true })
  @Index()
  providerId: string;

  // GitHub integration fields
  @Column({ type: 'text', nullable: true })
  githubUsername: string | null;

  @Column({ type: 'text', nullable: true })
  githubId: string | null;

  @Column({ type: 'boolean', default: false })
  githubStarClaimedWeb: boolean;

  @Column({ type: 'boolean', default: false })
  githubForkClaimedWeb: boolean;

  @Column({ type: 'boolean', default: false })
  githubStarClaimedApi: boolean;

  @Column({ type: 'boolean', default: false })
  githubForkClaimedApi: boolean;

  // Referral system fields
  @Column({ type: 'text', unique: true, nullable: true })
  @Index()
  referralCode: string | null;

  @Column({ type: 'text', nullable: true })
  referredByCode: string | null;

  @Column({ type: 'boolean', default: false })
  referralRewardGranted: boolean;

  @Column({ type: 'int', default: 0 })
  referralCreditsEarned: number;

  @OneToMany(() => VideoEntity, (video) => video.user)
  videos: VideoEntity[];

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
