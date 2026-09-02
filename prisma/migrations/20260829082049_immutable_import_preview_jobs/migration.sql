-- CreateTable
CREATE TABLE "ImportPreviewJob" (
    "id" TEXT NOT NULL,
    "userSessionId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "canonicalSourceUrl" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "savedCharacterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportPreviewJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportPreviewJob_userSessionId_createdAt_idx" ON "ImportPreviewJob"("userSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportPreviewJob_expiresAt_idx" ON "ImportPreviewJob"("expiresAt");

-- CreateIndex
CREATE INDEX "ImportPreviewJob_consumedAt_idx" ON "ImportPreviewJob"("consumedAt");

-- AddForeignKey
ALTER TABLE "ImportPreviewJob" ADD CONSTRAINT "ImportPreviewJob_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
