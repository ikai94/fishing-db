-- CreateEnum
CREATE TYPE "BaitType" AS ENUM ('BAIT', 'LURE');

-- CreateTable
CREATE TABLE "FishingBase" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "nameNormalized" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FishingBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "fishingBaseId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "nameNormalized" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fish" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "nameNormalized" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bait" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "nameNormalized" VARCHAR(128) NOT NULL,
    "type" "BaitType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationFish" (
    "locationId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationFish_pkey" PRIMARY KEY ("locationId","fishId")
);

-- CreateIndex
CREATE UNIQUE INDEX "FishingBase_nameNormalized_key" ON "FishingBase"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Location_fishingBaseId_number_key" ON "Location"("fishingBaseId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Location_fishingBaseId_nameNormalized_key" ON "Location"("fishingBaseId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Fish_nameNormalized_key" ON "Fish"("nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Bait_nameNormalized_key" ON "Bait"("nameNormalized");

-- CreateIndex
CREATE INDEX "LocationFish_fishId_idx" ON "LocationFish"("fishId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_fishingBaseId_fkey" FOREIGN KEY ("fishingBaseId") REFERENCES "FishingBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationFish" ADD CONSTRAINT "LocationFish_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationFish" ADD CONSTRAINT "LocationFish_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
