-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3);

-- Existing accounts predate email verification and remain usable.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthToken_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "AuthToken_terminal_state_check" CHECK (
        NOT ("consumedAt" IS NOT NULL AND "invalidatedAt" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "AuthEmailOutbox" (
    "id" UUID NOT NULL,
    "authTokenId" UUID NOT NULL,
    "recipientEmail" VARCHAR(254) NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthEmailOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthEmailOutbox_attempt_count_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "AuthEmailOutbox_terminal_state_check" CHECK (
        NOT ("sentAt" IS NOT NULL AND "cancelledAt" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
CREATE UNIQUE INDEX "AuthToken_active_user_purpose_key"
    ON "AuthToken"("userId", "purpose")
    WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;
CREATE UNIQUE INDEX "AuthEmailOutbox_authTokenId_key" ON "AuthEmailOutbox"("authTokenId");
CREATE INDEX "AuthEmailOutbox_availableAt_createdAt_idx"
    ON "AuthEmailOutbox"("availableAt", "createdAt");
CREATE INDEX "AuthEmailOutbox_leaseUntil_idx" ON "AuthEmailOutbox"("leaseUntil");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthEmailOutbox" ADD CONSTRAINT "AuthEmailOutbox_authTokenId_fkey"
    FOREIGN KEY ("authTokenId") REFERENCES "AuthToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
