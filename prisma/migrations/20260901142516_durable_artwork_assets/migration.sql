-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "artworkSha256" VARCHAR(64);

-- CreateTable
CREATE TABLE "ArtworkAsset" (
    "sha256" VARCHAR(64) NOT NULL,
    "mediaType" VARCHAR(32) NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtworkAsset_pkey" PRIMARY KEY ("sha256")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkAsset_storageKey_key" ON "ArtworkAsset"("storageKey");

-- CreateIndex
CREATE INDEX "Character_artworkSha256_idx" ON "Character"("artworkSha256");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_artworkSha256_fkey" FOREIGN KEY ("artworkSha256") REFERENCES "ArtworkAsset"("sha256") ON DELETE SET NULL ON UPDATE CASCADE;
