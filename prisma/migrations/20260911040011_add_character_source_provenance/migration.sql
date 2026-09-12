-- CreateEnum
CREATE TYPE "ImportProvider" AS ENUM ('JANITOR_AI', 'DATACAT', 'SAUCEPAN', 'CHARACTER_CARD', 'JANITOR_BRIDGE', 'MANUAL_JSON', 'ARTIFACT_UPLOAD', 'DEVELOPMENT_FIXTURE');

-- CreateTable
CREATE TABLE "CharacterSourceProvenance" (
    "id" TEXT NOT NULL,
    "characterSourceId" TEXT NOT NULL,
    "importProvider" "ImportProvider" NOT NULL,
    "providerUrl" TEXT NOT NULL,
    "providerExternalId" TEXT,
    "identityKey" VARCHAR(512) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterSourceProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharacterSourceProvenance_importProvider_identityKey_idx" ON "CharacterSourceProvenance"("importProvider", "identityKey");

-- CreateIndex
CREATE INDEX "CharacterSourceProvenance_characterSourceId_lastSeenAt_idx" ON "CharacterSourceProvenance"("characterSourceId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSourceProvenance_characterSourceId_importProvider__key" ON "CharacterSourceProvenance"("characterSourceId", "importProvider", "identityKey");

-- AddForeignKey
ALTER TABLE "CharacterSourceProvenance" ADD CONSTRAINT "CharacterSourceProvenance_characterSourceId_fkey" FOREIGN KEY ("characterSourceId") REFERENCES "CharacterSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
