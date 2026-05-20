import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthSystemMigration1748000000000 implements MigrationInterface {
  name = 'GrowthSystemMigration1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // GitHub fields on users table
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubUsername" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubId" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubStarClaimedWeb" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubForkClaimedWeb" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubStarClaimedApi" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "githubForkClaimedApi" boolean NOT NULL DEFAULT false`);

    // Referral fields on users table
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referredByCode" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralRewardGranted" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCreditsEarned" integer NOT NULL DEFAULT 0`);

    // Unique constraint + index on referralCode
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "UQ_users_referralCode" UNIQUE ("referralCode")
    `).catch(() => {/* already exists */});
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_referralCode" ON "users" ("referralCode")`);

    // Backfill referralCode for existing users — uses md5 + random float (no pgcrypto required)
    await queryRunner.query(`
      UPDATE "users"
      SET "referralCode" = substring(md5(random()::text || id::text), 1, 8)
      WHERE "referralCode" IS NULL
    `);

    // promo_codes table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_codes" (
        "id" SERIAL PRIMARY KEY,
        "code" text NOT NULL,
        "credits" integer NOT NULL,
        "maxUses" integer,
        "usedCount" integer NOT NULL DEFAULT 0,
        "expiresAt" timestamptz,
        "isActive" boolean NOT NULL DEFAULT true,
        "description" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_promo_codes_code" ON "promo_codes" ("code")`);

    // promo_code_redemptions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promo_code_redemptions" (
        "id" SERIAL PRIMARY KEY,
        "promoCodeId" integer NOT NULL,
        "userId" integer NOT NULL,
        "redeemedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_promo_redemptions_user_promo" ON "promo_code_redemptions" ("userId", "promoCodeId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_userId" ON "promo_code_redemptions" ("userId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_promo_redemptions_promoCodeId" ON "promo_code_redemptions" ("promoCodeId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_code_redemptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promo_codes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referralCreditsEarned"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referralRewardGranted"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referredByCode"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "referralCode"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubForkClaimedApi"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubStarClaimedApi"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubForkClaimedWeb"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubStarClaimedWeb"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "githubUsername"`);
  }
}
