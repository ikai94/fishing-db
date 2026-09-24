CREATE TABLE "FishRecordNote" (
    "fishId" UUID NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FishRecordNote_pkey" PRIMARY KEY ("fishId"),
    CONSTRAINT "FishRecordNote_note_not_blank" CHECK (char_length(btrim("note")) > 0)
);

ALTER TABLE "FishRecordNote" ADD CONSTRAINT "FishRecordNote_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
