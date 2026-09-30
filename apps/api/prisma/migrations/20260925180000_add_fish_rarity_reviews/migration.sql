CREATE TABLE "FishRarityReview" (
    "fishId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FishRarityReview_pkey" PRIMARY KEY ("fishId")
);

ALTER TABLE "FishRarityReview" ADD CONSTRAINT "FishRarityReview_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
