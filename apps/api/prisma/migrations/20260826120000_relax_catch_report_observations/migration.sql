BEGIN;

ALTER TABLE "CatchReport"
DROP CONSTRAINT "CatchReport_method_observations_check";

ALTER TABLE "CatchReport"
ADD CONSTRAINT "CatchReport_method_observations_check"
CHECK (
    "fishingMethod" = 'SPINNING'::"FishingMethod"
    OR
    (
        "fishingMethod" = 'BAIT_FISHING'::"FishingMethod"
        AND "spinningSize" IS NULL
        AND "spinningSpeed" IS NULL
    )
) NOT VALID;

ALTER TABLE "CatchReport"
VALIDATE CONSTRAINT "CatchReport_method_observations_check";

COMMIT;
