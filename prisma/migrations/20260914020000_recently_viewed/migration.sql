-- CreateTable
CREATE TABLE "CharacterView" (
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterView_pkey" PRIMARY KEY ("userId","characterId")
);

-- CreateIndex
CREATE INDEX "CharacterView_userId_lastViewedAt_idx" ON "CharacterView"("userId", "lastViewedAt" DESC);

-- CreateIndex
CREATE INDEX "CharacterView_characterId_idx" ON "CharacterView"("characterId");

-- AddForeignKey
ALTER TABLE "CharacterView" ADD CONSTRAINT "CharacterView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterView" ADD CONSTRAINT "CharacterView_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;