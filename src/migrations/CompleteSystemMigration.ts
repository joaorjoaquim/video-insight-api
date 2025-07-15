import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteSystemMigration1710000000002 implements MigrationInterface {
  name = 'CompleteSystemMigration1710000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing tables if they exist
    await queryRunner.query(`DROP TABLE IF EXISTS "videos" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_transactions" CASCADE`);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying,
        "name" character varying NOT NULL,
        "credits" integer NOT NULL DEFAULT 100,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )
    `);

    // Create videos table
    await queryRunner.query(`
      CREATE TABLE "videos" (
        "id" SERIAL NOT NULL,
        "videoUrl" character varying NOT NULL,
        "videoId" character varying,
        "title" character varying,
        "thumbnail" character varying,
        "duration" double precision,
        "downloadUrl" character varying,
        "transcriptionId" character varying,
        "transcription" text,
        "dashboard" jsonb,
        "tokensUsed" integer,
        "creditsCost" integer,
        "status" character varying NOT NULL DEFAULT 'pending',
        "errorMessage" character varying,
        "userId" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_e3c90975f226bf320112cfeda4f" PRIMARY KEY ("id")
      )
    `);

    // Create credit_transactions table
    await queryRunner.query(`
      CREATE TABLE "credit_transactions" (
        "id" SERIAL NOT NULL,
        "amount" integer NOT NULL,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'completed',
        "description" character varying,
        "referenceId" character varying,
        "referenceType" character varying,
        "tokensUsed" integer,
        "userId" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_transactions" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "videos"
      ADD CONSTRAINT "FK_64ebc44193a6c449432c0d4cd5f"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "credit_transactions"
      ADD CONSTRAINT "FK_credit_transactions_user"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Create indexes for better performance
    await queryRunner.query(`
      CREATE INDEX "IDX_videos_userId" ON "videos" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_videos_status" ON "videos" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_userId" ON "credit_transactions" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_type" ON "credit_transactions" ("type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_credit_transactions_createdAt" ON "credit_transactions" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints
    await queryRunner.query(
      `ALTER TABLE "credit_transactions" DROP CONSTRAINT "FK_credit_transactions_user"`
    );

    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_64ebc44193a6c449432c0d4cd5f"`
    );

    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_credit_transactions_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_credit_transactions_type"`);
    await queryRunner.query(`DROP INDEX "IDX_credit_transactions_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_userId"`);

    // Drop tables
    await queryRunner.query(`DROP TABLE "credit_transactions"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
} 