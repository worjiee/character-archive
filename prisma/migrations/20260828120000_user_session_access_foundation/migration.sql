-- Step 11B intentionally invalidates all legacy owner sessions and ephemeral browser-bridge state.
-- Durable archive, collection, import, source-connection, moderation, and settings data is untouched.
DELETE FROM "BridgePairing";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserAccessStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- DropForeignKey
ALTER TABLE "BridgePairing" DROP CONSTRAINT "BridgePairing_ownerSessionId_fkey";

-- DropIndex
DROP INDEX "BridgePairing_ownerSessionId_createdAt_idx";

-- AlterTable
ALTER TABLE "BridgePairing" DROP COLUMN "ownerSessionId",
ADD COLUMN "userSessionId" TEXT NOT NULL;

-- DropTable: legacy cookies cannot authenticate after this table is removed.
DROP TABLE "OwnerSession";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "accessStatus" "UserAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedUsername_key" ON "User"("normalizedUsername");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "BridgePairing_userSessionId_createdAt_idx" ON "BridgePairing"("userSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgePairing" ADD CONSTRAINT "BridgePairing_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
