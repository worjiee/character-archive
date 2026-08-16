-- CreateTable
CREATE TABLE "OwnerSession" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerSession_expiresAt_idx" ON "OwnerSession"("expiresAt");
