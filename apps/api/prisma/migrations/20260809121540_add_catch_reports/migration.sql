-- CreateEnum
CREATE TYPE "SpotLandmark" AS ENUM ('ROD', 'NOTEBOOK', 'BACKPACK', 'REEL', 'CHAT', 'TACKLE');

-- CreateEnum
CREATE TYPE "FishingNote" AS ENUM ('MIDWATER', 'FROM_BOTTOM', 'SURFACE');

-- CreateTable
CREATE TABLE "CatchReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "baitId" UUID NOT NULL,
    "weightGrams" INTEGER NOT NULL,
    "holeDepthCm" INTEGER,
    "spotLandmark" "SpotLandmark",
    "fishingNote" "FishingNote",
    "userNoteRaw" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatchReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatchReport_weightGrams_positive_check" CHECK ("weightGrams" > 0),
    CONSTRAINT "CatchReport_holeDepthCm_positive_check" CHECK ("holeDepthCm" IS NULL OR "holeDepthCm" > 0)
);

-- CreateIndex
CREATE INDEX "CatchReport_createdAt_id_idx" ON "CatchReport"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "CatchReport_userId_createdAt_id_idx" ON "CatchReport"("userId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "CatchReport" ADD CONSTRAINT "CatchReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatchReport" ADD CONSTRAINT "CatchReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatchReport" ADD CONSTRAINT "CatchReport_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatchReport" ADD CONSTRAINT "CatchReport_baitId_fkey" FOREIGN KEY ("baitId") REFERENCES "Bait"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
