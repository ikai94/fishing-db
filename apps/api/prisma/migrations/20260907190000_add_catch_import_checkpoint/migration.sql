-- CreateTable
CREATE TABLE "CatchImportRun" (
    "id" UUID NOT NULL,
    "releaseSha256" CHAR(64) NOT NULL,
    "manifestSha256" CHAR(64) NOT NULL,
    "targetUserId" UUID NOT NULL,
    "catalogSha256" CHAR(64) NOT NULL,
    "nextFileIndex" INTEGER NOT NULL DEFAULT 0,
    "nextLineNumber" INTEGER NOT NULL DEFAULT 1,
    "committedReports" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL,
    "lastErrorCode" VARCHAR(128),
    "lastErrorFile" VARCHAR(1000),
    "lastErrorLineNumber" INTEGER,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CatchImportRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatchImportRun_progress_check" CHECK (
        "nextFileIndex" >= 0
        AND "nextLineNumber" >= 1
        AND "committedReports" >= 0
        AND ("lastErrorLineNumber" IS NULL OR "lastErrorLineNumber" >= 1)
    ),
    CONSTRAINT "CatchImportRun_status_check" CHECK (
        "status" IN ('RUNNING', 'FAILED', 'COMPLETE')
    ),
    CONSTRAINT "CatchImportRun_completion_check" CHECK (
        ("status" = 'COMPLETE' AND "completedAt" IS NOT NULL)
        OR ("status" <> 'COMPLETE' AND "completedAt" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "CatchImportRun_releaseSha256_key" ON "CatchImportRun"("releaseSha256");
CREATE INDEX "CatchImportRun_targetUserId_idx" ON "CatchImportRun"("targetUserId");

-- AddForeignKey
ALTER TABLE "CatchImportRun" ADD CONSTRAINT "CatchImportRun_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
