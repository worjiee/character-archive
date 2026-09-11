-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'FAVORITE_CREATOR_NEW_CHARACTER';

-- CreateEnum
CREATE TYPE "CreatorIdentityKind" AS ENUM ('EXTERNAL_ID', 'CREATOR_NAME');

-- CreateEnum
CREATE TYPE "FavoriteCreatorProvenance" AS ENUM ('MANUAL', 'DATACAT');

-- CreateTable
CREATE TABLE "UserFavoriteCreator" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "identityKind" "CreatorIdentityKind" NOT NULL,
    "identityValue" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavoriteCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavoriteCreatorClaim" (
    "favoriteCreatorId" TEXT NOT NULL,
    "provenance" "FavoriteCreatorProvenance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavoriteCreatorClaim_pkey" PRIMARY KEY ("favoriteCreatorId", "provenance")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteCreator_userId_platform_identityKind_identityValue_key" ON "UserFavoriteCreator"("userId", "platform", "identityKind", "identityValue");

-- CreateIndex
CREATE INDEX "UserFavoriteCreator_userId_createdAt_idx" ON "UserFavoriteCreator"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFavoriteCreator_platform_identityKind_identityValue_createdAt_userId_idx" ON "UserFavoriteCreator"("platform", "identityKind", "identityValue", "createdAt", "userId");

-- CreateIndex
CREATE INDEX "UserFavoriteCreatorClaim_provenance_favoriteCreatorId_idx" ON "UserFavoriteCreatorClaim"("provenance", "favoriteCreatorId");

-- AddForeignKey
ALTER TABLE "UserFavoriteCreator" ADD CONSTRAINT "UserFavoriteCreator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteCreatorClaim" ADD CONSTRAINT "UserFavoriteCreatorClaim_favoriteCreatorId_fkey" FOREIGN KEY ("favoriteCreatorId") REFERENCES "UserFavoriteCreator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
