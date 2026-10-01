BEGIN;

-- Блокируем запись уловов на время единственного подсчёта истории и установки триггеров.
-- Чтение CatchReport разрешено; ни одна конкурентная запись не потеряется между этими шагами.
LOCK TABLE "CatchReport" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Fish" ADD COLUMN "catchReportsCount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Fish" ADD CONSTRAINT "Fish_catchReportsCount_nonnegative"
    CHECK ("catchReportsCount" >= 0);

UPDATE "Fish" AS fish
SET "catchReportsCount" = totals."reportsCount"
FROM (
    SELECT "fishId", COUNT(*) AS "reportsCount"
    FROM "CatchReport"
    GROUP BY "fishId"
) AS totals
WHERE fish."id" = totals."fishId";

-- Таблица переходов содержит только строки текущего INSERT/DELETE, включая пакетный импорт.
-- Один UPDATE на затронутый вид вместо отдельного триггерного UPDATE на каждый улов.
CREATE FUNCTION maintain_fish_catch_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    change_row RECORD;
    direction BIGINT := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END;
BEGIN
    -- Общий порядок блокировки рыб снижает риск взаимных блокировок пакетных операций.
    FOR change_row IN
        SELECT "fishId", COUNT(*) * direction AS delta
        FROM changed_reports
        GROUP BY "fishId"
        ORDER BY "fishId"
    LOOP
        UPDATE "Fish"
        SET "catchReportsCount" = "catchReportsCount" + change_row.delta
        WHERE "id" = change_row."fishId";
    END LOOP;
    RETURN NULL;
END;
$$;

-- UPDATE без смены вида даёт нулевую дельту и не переписывает Fish.
CREATE FUNCTION transfer_fish_catch_counts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    change_row RECORD;
BEGIN
    FOR change_row IN
        SELECT "fishId", SUM(delta)::bigint AS delta
        FROM (
            SELECT "fishId", COUNT(*) AS delta FROM new_reports GROUP BY "fishId"
            UNION ALL
            SELECT "fishId", -COUNT(*) AS delta FROM old_reports GROUP BY "fishId"
        ) AS changes
        GROUP BY "fishId"
        HAVING SUM(delta) <> 0
        ORDER BY "fishId"
    LOOP
        UPDATE "Fish"
        SET "catchReportsCount" = "catchReportsCount" + change_row.delta
        WHERE "id" = change_row."fishId";
    END LOOP;
    RETURN NULL;
END;
$$;

-- TRUNCATE не вызывает DELETE-триггер: отдельный путь сохраняет точность при служебной очистке.
CREATE FUNCTION clear_fish_catch_counts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "Fish" SET "catchReportsCount" = 0 WHERE "catchReportsCount" <> 0;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "CatchReport_count_insert"
AFTER INSERT ON "CatchReport"
REFERENCING NEW TABLE AS changed_reports
FOR EACH STATEMENT EXECUTE FUNCTION maintain_fish_catch_counts();

CREATE TRIGGER "CatchReport_count_delete"
AFTER DELETE ON "CatchReport"
REFERENCING OLD TABLE AS changed_reports
FOR EACH STATEMENT EXECUTE FUNCTION maintain_fish_catch_counts();

CREATE TRIGGER "CatchReport_count_update"
AFTER UPDATE ON "CatchReport"
REFERENCING OLD TABLE AS old_reports NEW TABLE AS new_reports
FOR EACH STATEMENT EXECUTE FUNCTION transfer_fish_catch_counts();

CREATE TRIGGER "CatchReport_count_truncate"
AFTER TRUNCATE ON "CatchReport"
FOR EACH STATEMENT EXECUTE FUNCTION clear_fish_catch_counts();

COMMIT;
