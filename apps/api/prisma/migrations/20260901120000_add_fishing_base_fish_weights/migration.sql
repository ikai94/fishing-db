BEGIN;

ALTER TABLE "FishingBaseFish"
ADD COLUMN "minWeightGrams" INTEGER,
ADD COLUMN "maxWeightGrams" INTEGER;

ALTER TABLE "FishingBaseFish"
ADD CONSTRAINT "FishingBaseFish_minWeightGrams_positive_check"
CHECK (
    "minWeightGrams" IS NULL
    OR "minWeightGrams" > 0
) NOT VALID,
ADD CONSTRAINT "FishingBaseFish_maxWeightGrams_positive_check"
CHECK (
    "maxWeightGrams" IS NULL
    OR "maxWeightGrams" > 0
) NOT VALID,
ADD CONSTRAINT "FishingBaseFish_weight_bounds_order_check"
CHECK (
    "minWeightGrams" IS NULL
    OR "maxWeightGrams" IS NULL
    OR "minWeightGrams" <= "maxWeightGrams"
) NOT VALID;

ALTER TABLE "FishingBaseFish"
VALIDATE CONSTRAINT "FishingBaseFish_minWeightGrams_positive_check";

ALTER TABLE "FishingBaseFish"
VALIDATE CONSTRAINT "FishingBaseFish_maxWeightGrams_positive_check";

ALTER TABLE "FishingBaseFish"
VALIDATE CONSTRAINT "FishingBaseFish_weight_bounds_order_check";

COMMIT;
