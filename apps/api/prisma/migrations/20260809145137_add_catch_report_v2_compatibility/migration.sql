BEGIN;

CREATE TYPE "FishingMethod" AS ENUM ('BAIT_FISHING', 'SPINNING');
CREATE TYPE "SpinningSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "SpinningSpeed" AS ENUM ('SLOW', 'MEDIUM', 'FAST');

ALTER TABLE "CatchReport"
ADD COLUMN "fishingMethod" "FishingMethod",
ADD COLUMN "rawSourceText" TEXT,
ADD COLUMN "spinningSize" "SpinningSize",
ADD COLUMN "spinningSpeed" "SpinningSpeed",
ADD COLUMN "spotPositionRaw" VARCHAR(1000);

-- Phase 4 had no historical method snapshot. The currently referenced Bait type
-- is the only safe deterministic evidence available; never infer this from a
-- Fish name or invent missing method-specific observations.
UPDATE "CatchReport" report
SET "fishingMethod" = CASE bait."type"
    WHEN 'BAIT'::"BaitType" THEN 'BAIT_FISHING'::"FishingMethod"
    WHEN 'LURE'::"BaitType" THEN 'SPINNING'::"FishingMethod"
END
FROM "Bait" bait
WHERE bait."id" = report."baitId";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "CatchReport" WHERE "fishingMethod" IS NULL) THEN
        RAISE EXCEPTION 'Phase 5 could not derive fishingMethod for every historical CatchReport';
    END IF;
END $$;

ALTER TABLE "CatchReport"
ALTER COLUMN "fishingMethod" SET NOT NULL;

UPDATE "CatchReport"
SET "spotPositionRaw" = CASE "spotLandmark"
    WHEN 'ROD'::"SpotLandmark" THEN 'удочка'
    WHEN 'NOTEBOOK'::"SpotLandmark" THEN 'блокнот'
    WHEN 'BACKPACK'::"SpotLandmark" THEN 'рюкзак'
    WHEN 'REEL'::"SpotLandmark" THEN 'катушка'
    WHEN 'CHAT'::"SpotLandmark" THEN 'чат'
    WHEN 'TACKLE'::"SpotLandmark" THEN 'снасти'
END
WHERE "spotLandmark" IS NOT NULL;

ALTER TABLE "CatchReport" DROP COLUMN "spotLandmark";
DROP TYPE "SpotLandmark";

ALTER TABLE "CatchReport"
ADD CONSTRAINT "CatchReport_spotPositionRaw_length_check"
CHECK (
    "spotPositionRaw" IS NULL
    OR char_length("spotPositionRaw") BETWEEN 1 AND 1000
),
ADD CONSTRAINT "CatchReport_rawSourceText_length_check"
CHECK (
    "rawSourceText" IS NULL
    OR char_length("rawSourceText") BETWEEN 1 AND 20000
);

CREATE TABLE "ScreenAnchor" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "nameNormalized" VARCHAR(128) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenAnchor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreenAnchor_nameNormalized_key"
ON "ScreenAnchor"("nameNormalized");

COMMIT;
