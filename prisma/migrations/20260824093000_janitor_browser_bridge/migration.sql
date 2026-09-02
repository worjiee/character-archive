-- CreateEnum
CREATE TYPE "BridgeOperation" AS ENUM ('CHARACTER_IMPORT');

-- CreateEnum
CREATE TYPE "BridgePayloadType" AS ENUM ('CHARACTER');

-- CreateEnum
CREATE TYPE "BridgeJobStatus" AS ENUM ('WAITING', 'PAIRED', 'READY', 'SAVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "BridgePairing" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "ownerSessionId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "operation" "BridgeOperation" NOT NULL,
    "archiveOrigin" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "exchangeAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgePairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeSession" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "payloadType" "BridgePayloadType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeJob" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "bridgeSessionId" TEXT,
    "status" "BridgeJobStatus" NOT NULL DEFAULT 'WAITING',
    "messageId" TEXT,
    "sourceUrl" TEXT,
    "capturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "payload" JSONB,
    "preview" JSONB,
    "errorCode" TEXT,
    "savedCharacterId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BridgePairing_codeHash_key" ON "BridgePairing"("codeHash");
CREATE INDEX "BridgePairing_ownerSessionId_createdAt_idx" ON "BridgePairing"("ownerSessionId", "createdAt");
CREATE INDEX "BridgePairing_expiresAt_idx" ON "BridgePairing"("expiresAt");
CREATE UNIQUE INDEX "BridgeSession_pairingId_key" ON "BridgeSession"("pairingId");
CREATE UNIQUE INDEX "BridgeSession_tokenHash_key" ON "BridgeSession"("tokenHash");
CREATE INDEX "BridgeSession_expiresAt_idx" ON "BridgeSession"("expiresAt");
CREATE UNIQUE INDEX "BridgeJob_pairingId_key" ON "BridgeJob"("pairingId");
CREATE UNIQUE INDEX "BridgeJob_bridgeSessionId_key" ON "BridgeJob"("bridgeSessionId");
CREATE UNIQUE INDEX "BridgeJob_bridgeSessionId_messageId_key" ON "BridgeJob"("bridgeSessionId", "messageId");
CREATE INDEX "BridgeJob_status_expiresAt_idx" ON "BridgeJob"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "BridgePairing" ADD CONSTRAINT "BridgePairing_ownerSessionId_fkey" FOREIGN KEY ("ownerSessionId") REFERENCES "OwnerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BridgeSession" ADD CONSTRAINT "BridgeSession_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "BridgePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "BridgePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BridgeJob" ADD CONSTRAINT "BridgeJob_bridgeSessionId_fkey" FOREIGN KEY ("bridgeSessionId") REFERENCES "BridgeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
