ALTER TABLE "Fish"
ADD COLUMN "isNightBiting" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FishWrongMaxIssue" (
    "fishId" UUID NOT NULL,
    "expectedWeightGrams" INTEGER,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FishWrongMaxIssue_pkey" PRIMARY KEY ("fishId"),
    CONSTRAINT "FishWrongMaxIssue_expected_weight_positive" CHECK ("expectedWeightGrams" IS NULL OR "expectedWeightGrams" > 0),
    CONSTRAINT "FishWrongMaxIssue_note_not_blank" CHECK ("note" IS NULL OR char_length(btrim("note")) > 0)
);

ALTER TABLE "FishWrongMaxIssue" ADD CONSTRAINT "FishWrongMaxIssue_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
