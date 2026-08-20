BEGIN;

ALTER TABLE "CatchReport"
ADD COLUMN "contributorKey" VARCHAR(255),
ADD COLUMN "importKey" VARCHAR(255);

-- Existing reports are native fishing-db observations. Keep ownership unchanged
-- while assigning every report from the same local User one contributor identity.
UPDATE "CatchReport"
SET "contributorKey" = 'local-user:' || "userId"::text;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "CatchReport"
        WHERE "contributorKey" IS NULL
           OR char_length("contributorKey") = 0
    ) THEN
        RAISE EXCEPTION 'CatchReport contributor identity backfill failed';
    END IF;
END $$;

ALTER TABLE "CatchReport"
ADD CONSTRAINT "CatchReport_contributorKey_nonempty_check"
CHECK (char_length("contributorKey") BETWEEN 1 AND 255) NOT VALID,
ADD CONSTRAINT "CatchReport_importKey_nonempty_check"
CHECK (
    "importKey" IS NULL
    OR char_length("importKey") BETWEEN 1 AND 255
) NOT VALID;

ALTER TABLE "CatchReport"
VALIDATE CONSTRAINT "CatchReport_contributorKey_nonempty_check";

ALTER TABLE "CatchReport"
VALIDATE CONSTRAINT "CatchReport_importKey_nonempty_check";

ALTER TABLE "CatchReport"
ALTER COLUMN "contributorKey" SET NOT NULL;

CREATE UNIQUE INDEX "CatchReport_importKey_key"
ON "CatchReport"("importKey");

CREATE FUNCTION "reject_catch_report_identity_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."contributorKey" IS DISTINCT FROM OLD."contributorKey" THEN
        RAISE EXCEPTION 'CatchReport contributorKey is immutable';
    END IF;

    IF NEW."importKey" IS DISTINCT FROM OLD."importKey" THEN
        RAISE EXCEPTION 'CatchReport importKey is immutable';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "CatchReport_identity_immutable_trigger"
BEFORE UPDATE OF "contributorKey", "importKey" ON "CatchReport"
FOR EACH ROW
EXECUTE FUNCTION "reject_catch_report_identity_change"();

COMMIT;
