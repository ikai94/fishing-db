CREATE TYPE "FishCommunityMark" AS ENUM ('BOTTOM', 'MIDWATER', 'FLY', 'NIGHT', 'TWILIGHT', 'DAY', 'ALL_DAY');
CREATE TABLE "FishCommunityVote" (
  "fishId" UUID NOT NULL REFERENCES "Fish"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mark" "FishCommunityMark" NOT NULL,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FishCommunityVote_pkey" PRIMARY KEY ("fishId", "mark", "userId")
);
CREATE INDEX "FishCommunityVote_userId_fishId_idx" ON "FishCommunityVote"("userId", "fishId");
