-- CreateEnum
CREATE TYPE "CharacterVersionOrigin" AS ENUM ('BASELINE', 'IMPORT', 'REIMPORT', 'ADMIN_EDIT', 'GREETING_EDIT');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "currentVersionFingerprint" VARCHAR(64);

-- CreateTable
CREATE TABLE "CharacterVersion" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "origin" "CharacterVersionOrigin" NOT NULL DEFAULT 'BASELINE',
    "snapshot" JSONB NOT NULL,
    "changeSummary" VARCHAR(255),
    "restoredFromVersion" INTEGER,
    "artworkSha256" VARCHAR(64),
    "tokenCount" INTEGER,
    "permanentTokenCount" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterVersion_characterId_versionNumber_key" ON "CharacterVersion"("characterId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterVersion_characterId_fingerprint_key" ON "CharacterVersion"("characterId", "fingerprint");

-- CreateIndex
CREATE INDEX "CharacterVersion_characterId_versionNumber_idx" ON "CharacterVersion"("characterId", "versionNumber" DESC);

-- CreateIndex
CREATE INDEX "CharacterVersion_characterId_createdAt_idx" ON "CharacterVersion"("characterId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CharacterVersion_artworkSha256_idx" ON "CharacterVersion"("artworkSha256");

-- AddForeignKey
ALTER TABLE "CharacterVersion" ADD CONSTRAINT "CharacterVersion_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterVersion" ADD CONSTRAINT "CharacterVersion_artworkSha256_fkey" FOREIGN KEY ("artworkSha256") REFERENCES "ArtworkAsset"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterVersion" ADD CONSTRAINT "CharacterVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
