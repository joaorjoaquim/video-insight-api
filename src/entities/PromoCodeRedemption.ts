import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('promo_code_redemptions')
@Unique(['userId', 'promoCodeId'])
export class PromoCodeRedemptionEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int' })
  @Index()
  promoCodeId: number;

  @Column({ type: 'int' })
  @Index()
  userId: number;

  @CreateDateColumn()
  redeemedAt: Date;
}
