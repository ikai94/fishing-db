BEGIN;

-- Проверка под блокировкой исключает появление непустых советов между аудитом и удалением.
LOCK TABLE "BaseFishNotebookEntry" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "BaseFishNotebookEntry"
        WHERE "fishingTips" IS NOT NULL AND "fishingTips" ~ '[^[:space:]]'
    ) THEN
        RAISE EXCEPTION 'Notebook removal stopped: non-empty fishingTips exist';
    END IF;
END $$;

-- Удаляется только ненужное поле; владельцы, личные заметки и даты остаются прежними.
ALTER TABLE "BaseFishNotebookEntry" DROP COLUMN "fishingTips";

COMMIT;
