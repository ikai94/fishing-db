BEGIN;

-- Only the exact, case-sensitive trailing marker is eligible for reconciliation.
-- Keep the mapping explicit so every catalog and CatchReport reference can be
-- repointed before a semantic duplicate Fish row is removed.
CREATE TEMP TABLE "_Phase5FishMerge" (
    "sourceFishId" UUID PRIMARY KEY,
    "targetFishId" UUID NOT NULL
) ON COMMIT DROP;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Fish" marked
        WHERE right(marked."name", char_length(' (спиннинг)')) = ' (спиннинг)'
          AND (
              char_length(marked."name") <= char_length(' (спиннинг)')
              OR right(marked."nameNormalized", char_length(' (спиннинг)')) <> ' (спиннинг)'
          )
    ) THEN
        RAISE EXCEPTION 'Phase 5 Fish reconciliation found an invalid exact spinning suffix candidate';
    END IF;
END $$;

INSERT INTO "_Phase5FishMerge" ("sourceFishId", "targetFishId")
SELECT marked."id", canonical."id"
FROM "Fish" marked
JOIN "Fish" canonical
  ON canonical."nameNormalized" = left(
      marked."nameNormalized",
      char_length(marked."nameNormalized") - char_length(' (спиннинг)')
  )
WHERE right(marked."name", char_length(' (спиннинг)')) = ' (спиннинг)';

DO $$
DECLARE
    conflicting_pairs TEXT;
BEGIN
    SELECT string_agg(
        merge."sourceFishId"::text || '->' || merge."targetFishId"::text,
        ', '
        ORDER BY merge."sourceFishId"::text
    )
    INTO conflicting_pairs
    FROM "_Phase5FishMerge" merge
    JOIN "Fish" marked ON marked."id" = merge."sourceFishId"
    JOIN "Fish" canonical ON canonical."id" = merge."targetFishId"
    WHERE marked."isActive" IS DISTINCT FROM canonical."isActive";

    IF conflicting_pairs IS NOT NULL THEN
        RAISE EXCEPTION 'Phase 5 Fish reconciliation requires explicit active-state resolution for: %', conflicting_pairs;
    END IF;
END $$;

CREATE TEMP TABLE "_Phase5MigrationAudit" (
    "name" TEXT PRIMARY KEY,
    "value" BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_Phase5MigrationAudit" ("name", "value")
SELECT 'catchReportsBefore', count(*) FROM "CatchReport";

INSERT INTO "_Phase5MigrationAudit" ("name", "value")
SELECT 'expectedBaseFishPairs', count(*)
FROM (
    SELECT DISTINCT
        location."fishingBaseId",
        COALESCE(merge."targetFishId", location_fish."fishId") AS "fishId"
    FROM "LocationFish" location_fish
    JOIN "Location" location ON location."id" = location_fish."locationId"
    LEFT JOIN "_Phase5FishMerge" merge ON merge."sourceFishId" = location_fish."fishId"
) pairs;

CREATE TABLE "FishingBaseFish" (
    "fishingBaseId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FishingBaseFish_pkey" PRIMARY KEY ("fishingBaseId", "fishId")
);

CREATE INDEX "FishingBaseFish_fishId_idx" ON "FishingBaseFish"("fishId");

ALTER TABLE "FishingBaseFish"
ADD CONSTRAINT "FishingBaseFish_fishingBaseId_fkey"
FOREIGN KEY ("fishingBaseId") REFERENCES "FishingBase"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FishingBaseFish"
ADD CONSTRAINT "FishingBaseFish_fishId_fkey"
FOREIGN KEY ("fishId") REFERENCES "Fish"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FishingBaseFish" ("fishingBaseId", "fishId", "createdAt")
SELECT
    location."fishingBaseId",
    COALESCE(merge."targetFishId", location_fish."fishId"),
    MIN(location_fish."createdAt")
FROM "LocationFish" location_fish
JOIN "Location" location ON location."id" = location_fish."locationId"
LEFT JOIN "_Phase5FishMerge" merge ON merge."sourceFishId" = location_fish."fishId"
GROUP BY
    location."fishingBaseId",
    COALESCE(merge."targetFishId", location_fish."fishId");

DO $$
DECLARE
    expected_count BIGINT;
    actual_count BIGINT;
BEGIN
    SELECT "value" INTO expected_count
    FROM "_Phase5MigrationAudit"
    WHERE "name" = 'expectedBaseFishPairs';

    SELECT count(*) INTO actual_count FROM "FishingBaseFish";

    IF actual_count <> expected_count THEN
        RAISE EXCEPTION 'Phase 5 Base/Fish migration count mismatch: expected %, got %', expected_count, actual_count;
    END IF;
END $$;

UPDATE "CatchReport" report
SET "fishId" = merge."targetFishId"
FROM "_Phase5FishMerge" merge
WHERE report."fishId" = merge."sourceFishId";

ALTER TABLE "LocationFish" DROP CONSTRAINT "LocationFish_fishId_fkey";
ALTER TABLE "LocationFish" DROP CONSTRAINT "LocationFish_locationId_fkey";
DROP TABLE "LocationFish";

DELETE FROM "Fish" fish
USING "_Phase5FishMerge" merge
WHERE fish."id" = merge."sourceFishId";

UPDATE "Fish" fish
SET
    "name" = left(fish."name", char_length(fish."name") - char_length(' (спиннинг)')),
    "nameNormalized" = left(
        fish."nameNormalized",
        char_length(fish."nameNormalized") - char_length(' (спиннинг)')
    )
WHERE right(fish."name", char_length(' (спиннинг)')) = ' (спиннинг)';

DO $$
DECLARE
    catch_reports_before BIGINT;
    catch_reports_after BIGINT;
BEGIN
    SELECT "value" INTO catch_reports_before
    FROM "_Phase5MigrationAudit"
    WHERE "name" = 'catchReportsBefore';

    SELECT count(*) INTO catch_reports_after FROM "CatchReport";

    IF catch_reports_after <> catch_reports_before THEN
        RAISE EXCEPTION 'Phase 5 Fish reconciliation changed CatchReport count';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "Fish"
        WHERE right("name", char_length(' (спиннинг)')) = ' (спиннинг)'
    ) THEN
        RAISE EXCEPTION 'Phase 5 Fish reconciliation left exact spinning suffix rows';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "CatchReport" report
        JOIN "_Phase5FishMerge" merge ON merge."sourceFishId" = report."fishId"
    ) THEN
        RAISE EXCEPTION 'Phase 5 Fish reconciliation left CatchReport references to merged Fish rows';
    END IF;
END $$;

COMMIT;
