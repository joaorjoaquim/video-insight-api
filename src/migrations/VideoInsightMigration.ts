import { MigrationInterface, QueryRunner } from 'typeorm';

export class VideoInsightMigration1710000000000 implements MigrationInterface {
  name = 'VideoInsightMigration1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(`
            CREATE TABLE "users" (
                "id" SERIAL NOT NULL,
                "email" character varying NOT NULL,
                "password" character varying NOT NULL,
                "name" character varying NOT NULL,
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
                "summary" text,
                "insights" jsonb,
                "status" character varying NOT NULL DEFAULT 'pending',
                "errorMessage" character varying,
                "userId" integer NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_e3c90975f226bf320112cfeda4f" PRIMARY KEY ("id")
            )
        `);

    // Add foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "videos"
            ADD CONSTRAINT "FK_64ebc44193a6c449432c0d4cd5f"
            FOREIGN KEY ("userId")
            REFERENCES "users"("id")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_64ebc44193a6c449432c0d4cd5f"`
    );

    // Drop videos table
    await queryRunner.query(`DROP TABLE "videos"`);

    // Drop users table
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
