BEGIN;

-- Compatibility migrations deliberately keep incomplete historical rows readable.
-- Refuse to enable the steady-state invariant until the read-only audit is clean;
-- never invent method-specific observations in SQL.
DO $$
DECLARE
    incompatible_count BIGINT;
    sample_ids TEXT;
BEGIN
    SELECT count(*)
    INTO incompatible_count
    FROM "CatchReport"
    WHERE NOT (
        (
            "fishingMethod" = 'BAIT_FISHING'::"FishingMethod"
            AND "holeDepthCm" IS NOT NULL
            AND "spinningSize" IS NULL
            AND "spinningSpeed" IS NULL
        )
        OR
        (
            "fishingMethod" = 'SPINNING'::"FishingMethod"
            AND "spinningSize" IS NOT NULL
            AND "spinningSpeed" IS NOT NULL
        )
    );

    IF incompatible_count > 0 THEN
        SELECT string_agg("id"::text, ', ' ORDER BY "id"::text)
        INTO sample_ids
        FROM (
            SELECT "id"
            FROM "CatchReport"
            WHERE NOT (
                (
                    "fishingMethod" = 'BAIT_FISHING'::"FishingMethod"
                    AND "holeDepthCm" IS NOT NULL
                    AND "spinningSize" IS NULL
                    AND "spinningSpeed" IS NULL
                )
                OR
                (
                    "fishingMethod" = 'SPINNING'::"FishingMethod"
                    AND "spinningSize" IS NOT NULL
                    AND "spinningSpeed" IS NOT NULL
                )
            )
            ORDER BY "id"
            LIMIT 20
        ) incompatible;

        RAISE EXCEPTION
            'CatchReport v2 invariant audit failed for % row(s); sample ids: %',
            incompatible_count,
            sample_ids;
    END IF;
END $$;

ALTER TABLE "CatchReport"
ADD CONSTRAINT "CatchReport_method_observations_check"
CHECK (
    (
        "fishingMethod" = 'BAIT_FISHING'::"FishingMethod"
        AND "holeDepthCm" IS NOT NULL
        AND "spinningSize" IS NULL
        AND "spinningSpeed" IS NULL
    )
    OR
    (
        "fishingMethod" = 'SPINNING'::"FishingMethod"
        AND "spinningSize" IS NOT NULL
        AND "spinningSpeed" IS NOT NULL
    )
) NOT VALID;

ALTER TABLE "CatchReport"
VALIDATE CONSTRAINT "CatchReport_method_observations_check";

COMMIT;
