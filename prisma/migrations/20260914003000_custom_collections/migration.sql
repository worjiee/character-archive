-- CreateTable
CREATE TABLE "CharacterCollection" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "normalizedName" VARCHAR(50) NOT NULL,
    "description" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterCollectionItem" (
    "collectionId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterCollectionItem_pkey" PRIMARY KEY ("collectionId","characterId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterCollection_ownerUserId_normalizedName_key" ON "CharacterCollection"("ownerUserId", "normalizedName");

-- CreateIndex
CREATE INDEX "CharacterCollection_ownerUserId_updatedAt_idx" ON "CharacterCollection"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "CharacterCollection_ownerUserId_createdAt_idx" ON "CharacterCollection"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CharacterCollectionItem_collectionId_addedAt_idx" ON "CharacterCollectionItem"("collectionId", "addedAt");

-- CreateIndex
CREATE INDEX "CharacterCollectionItem_characterId_idx" ON "CharacterCollectionItem"("characterId");

-- AddForeignKey
ALTER TABLE "CharacterCollection" ADD CONSTRAINT "CharacterCollection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCollectionItem" ADD CONSTRAINT "CharacterCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "CharacterCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterCollectionItem" ADD CONSTRAINT "CharacterCollectionItem_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
