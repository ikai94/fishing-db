-- Индекс строится без блокировки записи в многомиллионную историю уловов.
CREATE INDEX CONCURRENTLY "CatchReport_fishId_idx" ON "CatchReport"("fishId");
