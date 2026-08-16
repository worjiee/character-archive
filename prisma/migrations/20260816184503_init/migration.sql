-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('JANITOR_AI', 'SAUCEPAN', 'DATACAT', 'OTHER');

-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "BlockRuleType" AS ENUM ('CHARACTER_NAME', 'CREATOR_NAME', 'CREATOR_ID', 'TAG', 'KEYWORD');

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "personality" TEXT,
    "scenario" TEXT,
    "exampleDialogs" TEXT,
    "avatarUrl" TEXT,
    "status" "CharacterStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockedReason" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "normalizedName" TEXT,
    "contentFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSource" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalCreatorId" TEXT,
    "creatorName" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "rawData" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),

    CONSTRAINT "CharacterSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Greeting" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "characterSourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "rawData" JSONB,

    CONSTRAINT "Greeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterTag" (
    "characterId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "CharacterTag_pkey" PRIMARY KEY ("characterId","tagId")
);

-- CreateTable
CREATE TABLE "Lorebook" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "externalId" TEXT NOT NULL,
    "sourcePlatform" "SourcePlatform" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Lorebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterLorebook" (
    "characterId" TEXT NOT NULL,
    "lorebookId" TEXT NOT NULL,

    CONSTRAINT "CharacterLorebook_pkey" PRIMARY KEY ("characterId","lorebookId")
);

-- CreateTable
CREATE TABLE "LorebookEntry" (
    "id" TEXT NOT NULL,
    "lorebookId" TEXT NOT NULL,
    "externalEntryId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keys" TEXT[],
    "category" TEXT,
    "comment" TEXT,
    "caseSensitive" BOOLEAN,
    "activationMode" TEXT,
    "activationScript" TEXT,
    "groupWeight" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "constant" BOOLEAN NOT NULL DEFAULT false,
    "insertionOrder" INTEGER NOT NULL DEFAULT 0,
    "rawData" JSONB NOT NULL,

    CONSTRAINT "LorebookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockRule" (
    "id" TEXT NOT NULL,
    "type" "BlockRuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedCreator" (
    "id" TEXT NOT NULL,
    "platform" "SourcePlatform",
    "externalCreatorId" TEXT,
    "creatorName" TEXT,
    "reason" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedCreator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Character_name_idx" ON "Character"("name");

-- CreateIndex
CREATE INDEX "Character_status_idx" ON "Character"("status");

-- CreateIndex
CREATE INDEX "Character_normalizedName_idx" ON "Character"("normalizedName");

-- CreateIndex
CREATE INDEX "Character_contentFingerprint_idx" ON "Character"("contentFingerprint");

-- CreateIndex
CREATE INDEX "Character_createdAt_idx" ON "Character"("createdAt");

-- CreateIndex
CREATE INDEX "CharacterSource_characterId_idx" ON "CharacterSource"("characterId");

-- CreateIndex
CREATE INDEX "CharacterSource_characterId_platform_idx" ON "CharacterSource"("characterId", "platform");

-- CreateIndex
CREATE INDEX "CharacterSource_platform_externalCreatorId_idx" ON "CharacterSource"("platform", "externalCreatorId");

-- CreateIndex
CREATE INDEX "CharacterSource_creatorName_idx" ON "CharacterSource"("creatorName");

-- CreateIndex
CREATE INDEX "CharacterSource_lastSyncedAt_idx" ON "CharacterSource"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSource_platform_externalId_key" ON "CharacterSource"("platform", "externalId");

-- CreateIndex
CREATE INDEX "Greeting_characterId_position_idx" ON "Greeting"("characterId", "position");

-- CreateIndex
CREATE INDEX "Greeting_characterId_externalId_idx" ON "Greeting"("characterId", "externalId");

-- CreateIndex
CREATE INDEX "Greeting_characterSourceId_position_idx" ON "Greeting"("characterSourceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "CharacterTag_tagId_idx" ON "CharacterTag"("tagId");

-- CreateIndex
CREATE INDEX "Lorebook_title_idx" ON "Lorebook"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Lorebook_sourcePlatform_externalId_key" ON "Lorebook"("sourcePlatform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Lorebook_sourcePlatform_sourceUrl_key" ON "Lorebook"("sourcePlatform", "sourceUrl");

-- CreateIndex
CREATE INDEX "CharacterLorebook_lorebookId_idx" ON "CharacterLorebook"("lorebookId");

-- CreateIndex
CREATE INDEX "LorebookEntry_lorebookId_enabled_insertionOrder_idx" ON "LorebookEntry"("lorebookId", "enabled", "insertionOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LorebookEntry_lorebookId_externalEntryId_key" ON "LorebookEntry"("lorebookId", "externalEntryId");

-- CreateIndex
CREATE INDEX "BlockRule_enabled_idx" ON "BlockRule"("enabled");

-- CreateIndex
CREATE INDEX "BlockRule_createdAt_idx" ON "BlockRule"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockRule_type_value_key" ON "BlockRule"("type", "value");

-- CreateIndex
CREATE INDEX "BlockedCreator_platform_externalCreatorId_idx" ON "BlockedCreator"("platform", "externalCreatorId");

-- CreateIndex
CREATE INDEX "BlockedCreator_platform_creatorName_idx" ON "BlockedCreator"("platform", "creatorName");

-- CreateIndex
CREATE INDEX "BlockedCreator_creatorName_idx" ON "BlockedCreator"("creatorName");

-- CreateIndex
CREATE INDEX "BlockedCreator_enabled_idx" ON "BlockedCreator"("enabled");

-- CreateIndex
CREATE INDEX "BlockedCreator_createdAt_idx" ON "BlockedCreator"("createdAt");

-- AddForeignKey
ALTER TABLE "CharacterSource" ADD CONSTRAINT "CharacterSource_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Greeting" ADD CONSTRAINT "Greeting_characterSourceId_fkey" FOREIGN KEY ("characterSourceId") REFERENCES "CharacterSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLorebook" ADD CONSTRAINT "CharacterLorebook_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLorebook" ADD CONSTRAINT "CharacterLorebook_lorebookId_fkey" FOREIGN KEY ("lorebookId") REFERENCES "Lorebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorebookEntry" ADD CONSTRAINT "LorebookEntry_lorebookId_fkey" FOREIGN KEY ("lorebookId") REFERENCES "Lorebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
