-- AlterTable
ALTER TABLE "Character" ADD COLUMN "tokenCount" INTEGER,
ADD COLUMN "permanentTokenCount" INTEGER;

-- CreateIndex
CREATE INDEX "Character_tokenCount_idx" ON "Character"("tokenCount");
