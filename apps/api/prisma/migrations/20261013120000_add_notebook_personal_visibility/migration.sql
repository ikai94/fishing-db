-- Метаданные PostgreSQL задают false существующим записям, не меняя заметки и даты.
ALTER TABLE "BaseFishNotebookEntry" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;
