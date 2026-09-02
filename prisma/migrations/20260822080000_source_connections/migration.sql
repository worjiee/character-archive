-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceConnection_platform_key" ON "SourceConnection"("platform");
