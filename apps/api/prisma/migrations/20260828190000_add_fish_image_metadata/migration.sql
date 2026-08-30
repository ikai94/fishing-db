BEGIN;

ALTER TABLE "Fish"
ADD COLUMN "forumTopicId" VARCHAR(32),
ADD COLUMN "officialFishImageKey" INTEGER;

ALTER TABLE "Fish"
ADD CONSTRAINT "Fish_officialFishImageKey_positive_check"
CHECK (
    "officialFishImageKey" IS NULL
    OR "officialFishImageKey" > 0
) NOT VALID;

ALTER TABLE "Fish"
VALIDATE CONSTRAINT "Fish_officialFishImageKey_positive_check";

CREATE UNIQUE INDEX "Fish_forumTopicId_key"
ON "Fish"("forumTopicId");

CREATE UNIQUE INDEX "Fish_officialFishImageKey_key"
ON "Fish"("officialFishImageKey");

COMMIT;
