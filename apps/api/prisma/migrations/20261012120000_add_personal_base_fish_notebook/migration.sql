-- Добавляем только новую таблицу; существующие каталог, веса и уловы не переписываются.
CREATE TABLE "BaseFishNotebookEntry" (
    "userId" UUID NOT NULL,
    "fishingBaseId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "noteText" TEXT,
    "fishingTips" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BaseFishNotebookEntry_pkey" PRIMARY KEY ("userId", "fishingBaseId", "fishId"),
    CONSTRAINT "BaseFishNotebookEntry_noteText_length_check" CHECK ("noteText" IS NULL OR char_length("noteText") <= 5000),
    CONSTRAINT "BaseFishNotebookEntry_fishingTips_length_check" CHECK ("fishingTips" IS NULL OR char_length("fishingTips") <= 5000),
    CONSTRAINT "BaseFishNotebookEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaseFishNotebookEntry_baseFish_fkey" FOREIGN KEY ("fishingBaseId", "fishId") REFERENCES "FishingBaseFish"("fishingBaseId", "fishId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Индекс обслуживает FK пары; первичный ключ покрывает чтение записей текущего ADMIN на базе.
CREATE INDEX "BaseFishNotebookEntry_fishingBaseId_fishId_idx" ON "BaseFishNotebookEntry"("fishingBaseId", "fishId");
