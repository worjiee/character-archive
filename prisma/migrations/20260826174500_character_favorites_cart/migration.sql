-- CreateTable
CREATE TABLE "CharacterFavorite" (
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterFavorite_pkey" PRIMARY KEY ("characterId")
);

-- CreateTable
CREATE TABLE "CharacterCartItem" (
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterCartItem_pkey" PRIMARY KEY ("characterId")
);

-- CreateIndex
CREATE INDEX "CharacterFavorite_createdAt_idx" ON "CharacterFavorite"("createdAt");

-- CreateIndex
CREATE INDEX "CharacterCartItem_createdAt_idx" ON "CharacterCartItem"("createdAt");

-- AddForeignKey
ALTER TABLE "CharacterFavorite" ADD CONSTRAINT "CharacterFavorite_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCartItem" ADD CONSTRAINT "CharacterCartItem_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
