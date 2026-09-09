CREATE TABLE "OfficialRecordSyncState" (
    "id" INTEGER NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseOwner" UUID,
    CONSTRAINT "OfficialRecordSyncState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OfficialRecordSyncState_singleton" CHECK ("id" = 1),
    CONSTRAINT "OfficialRecordSyncState_lease_pair" CHECK (("leaseUntil" IS NULL) = ("leaseOwner" IS NULL)),
    CONSTRAINT "OfficialRecordSyncState_failure_count" CHECK ("failureCount" >= 0)
);

CREATE TABLE "OfficialRecordSnapshot" (
    "id" UUID NOT NULL,
    "weekStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "parserVersion" INTEGER NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    CONSTRAINT "OfficialRecordSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OfficialRecordSnapshot_hash" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "OfficialRecordSnapshot_versions" CHECK ("parserVersion" > 0 AND "mappingVersion" > 0)
);

CREATE TABLE "OfficialRecordSnapshotRow" (
    "snapshotId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "fishingBaseId" UUID,
    "weightGrams" INTEGER NOT NULL,
    "sourceFishName" VARCHAR(128) NOT NULL,
    "sourceFishPath" VARCHAR(255) NOT NULL,
    "waterbodyRaw" VARCHAR(128) NOT NULL,
    "playerNameRaw" VARCHAR(128) NOT NULL,
    "caughtAt" TIMESTAMPTZ(3) NOT NULL,
    "caughtAtRaw" VARCHAR(32) NOT NULL,
    CONSTRAINT "OfficialRecordSnapshotRow_pkey" PRIMARY KEY ("snapshotId", "fishId"),
    CONSTRAINT "OfficialRecordSnapshotRow_weight" CHECK ("weightGrams" > 0)
);

CREATE UNIQUE INDEX "OfficialRecordSnapshot_weekStartsAt_fetchedAt_key" ON "OfficialRecordSnapshot"("weekStartsAt", "fetchedAt");
CREATE INDEX "OfficialRecordSnapshot_weekStartsAt_fetchedAt_idx" ON "OfficialRecordSnapshot"("weekStartsAt", "fetchedAt" DESC);
CREATE INDEX "OfficialRecordSnapshotRow_fishId_idx" ON "OfficialRecordSnapshotRow"("fishId");
CREATE INDEX "OfficialRecordSnapshotRow_fishingBaseId_idx" ON "OfficialRecordSnapshotRow"("fishingBaseId");

ALTER TABLE "OfficialRecordSnapshotRow" ADD CONSTRAINT "OfficialRecordSnapshotRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OfficialRecordSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficialRecordSnapshotRow" ADD CONSTRAINT "OfficialRecordSnapshotRow_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficialRecordSnapshotRow" ADD CONSTRAINT "OfficialRecordSnapshotRow_fishingBaseId_fkey" FOREIGN KEY ("fishingBaseId") REFERENCES "FishingBase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_official_record_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'official record history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OfficialRecordSnapshot_append_only" BEFORE UPDATE OR DELETE ON "OfficialRecordSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_official_record_history_mutation();
CREATE TRIGGER "OfficialRecordSnapshotRow_append_only" BEFORE UPDATE OR DELETE ON "OfficialRecordSnapshotRow" FOR EACH ROW EXECUTE FUNCTION reject_official_record_history_mutation();

INSERT INTO "OfficialRecordSyncState" ("id") VALUES (1);
