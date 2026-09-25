CREATE TABLE "UserFavoriteFish" (
    "userId" UUID NOT NULL,
    "fishId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFavoriteFish_pkey" PRIMARY KEY ("userId", "fishId")
);

CREATE INDEX "UserFavoriteFish_fishId_idx" ON "UserFavoriteFish"("fishId");

ALTER TABLE "UserFavoriteFish" ADD CONSTRAINT "UserFavoriteFish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFavoriteFish" ADD CONSTRAINT "UserFavoriteFish_fishId_fkey" FOREIGN KEY ("fishId") REFERENCES "Fish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
