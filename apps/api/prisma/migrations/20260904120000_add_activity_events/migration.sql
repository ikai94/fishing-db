BEGIN;

CREATE TYPE "ActivityEventType" AS ENUM (
    'CATCH_REPORT_CREATED',
    'CATCH_REPORT_BATCH_CREATED',
    'CATCH_REPORT_UPDATED',
    'CATCH_REPORT_DELETED',
    'CATALOG_ITEM_CREATED',
    'CATALOG_ITEM_UPDATED',
    'FISHING_BASE_FISH_ADDED',
    'FISHING_BASE_FISH_UPDATED',
    'FISHING_BASE_FISH_REMOVED'
);

CREATE TYPE "ActivitySubjectType" AS ENUM (
    'CATCH_REPORT',
    'CATCH_REPORT_BATCH',
    'FISHING_BASE',
    'LOCATION',
    'FISH',
    'BAIT',
    'FISHING_BASE_FISH'
);

CREATE TABLE "ActivityEvent" (
    "id" BIGSERIAL NOT NULL,
    "type" "ActivityEventType" NOT NULL,
    "subjectType" "ActivitySubjectType" NOT NULL,
    "subjectKey" VARCHAR(80) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorNicknameSnapshot" VARCHAR(32) NOT NULL,
    "actorRoleSnapshot" "UserRole" NOT NULL,
    "payloadVersion" SMALLINT NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActivityEvent_actorUserId_fkey"
        FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityEvent_actorNicknameSnapshot_nonempty_check"
        CHECK (char_length("actorNicknameSnapshot") BETWEEN 1 AND 32),
    CONSTRAINT "ActivityEvent_subjectKey_nonempty_check"
        CHECK (char_length("subjectKey") BETWEEN 1 AND 80),
    CONSTRAINT "ActivityEvent_payloadVersion_check"
        CHECK ("payloadVersion" = 1),
    CONSTRAINT "ActivityEvent_payload_object_check"
        CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "ActivityEvent_type_subject_check"
        CHECK (
            ("type" IN (
                'CATCH_REPORT_CREATED'::"ActivityEventType",
                'CATCH_REPORT_UPDATED'::"ActivityEventType",
                'CATCH_REPORT_DELETED'::"ActivityEventType"
            ) AND "subjectType" = 'CATCH_REPORT'::"ActivitySubjectType")
            OR
            ("type" = 'CATCH_REPORT_BATCH_CREATED'::"ActivityEventType"
                AND "subjectType" = 'CATCH_REPORT_BATCH'::"ActivitySubjectType")
            OR
            ("type" IN (
                'CATALOG_ITEM_CREATED'::"ActivityEventType",
                'CATALOG_ITEM_UPDATED'::"ActivityEventType"
            ) AND "subjectType" IN (
                'FISHING_BASE'::"ActivitySubjectType",
                'LOCATION'::"ActivitySubjectType",
                'FISH'::"ActivitySubjectType",
                'BAIT'::"ActivitySubjectType"
            ))
            OR
            ("type" IN (
                'FISHING_BASE_FISH_ADDED'::"ActivityEventType",
                'FISHING_BASE_FISH_UPDATED'::"ActivityEventType",
                'FISHING_BASE_FISH_REMOVED'::"ActivityEventType"
            ) AND "subjectType" = 'FISHING_BASE_FISH'::"ActivitySubjectType")
        )
);

CREATE INDEX "ActivityEvent_subjectType_subjectKey_id_idx"
ON "ActivityEvent"("subjectType", "subjectKey", "id" DESC);

CREATE FUNCTION "reject_activity_event_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'ActivityEvent is append-only';
END;
$$;

CREATE TRIGGER "ActivityEvent_append_only_trigger"
BEFORE UPDATE OR DELETE ON "ActivityEvent"
FOR EACH ROW
EXECUTE FUNCTION "reject_activity_event_change"();

COMMIT;
