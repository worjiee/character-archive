-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('DARK', 'LIGHT', 'SYSTEM');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "avatarUrlOverride" TEXT,
ADD COLUMN     "descriptionOverride" TEXT,
ADD COLUMN     "nameOverride" TEXT,
ADD COLUMN     "personalityOverride" TEXT,
ADD COLUMN     "scenarioOverride" TEXT,
ADD COLUMN     "statusBeforeDelete" "CharacterStatus";

-- AlterTable
ALTER TABLE "Greeting" ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "localPosition" INTEGER;

-- CreateTable
CREATE TABLE "RepositorySettings" (
    "id" TEXT NOT NULL DEFAULT 'repository',
    "siteName" TEXT NOT NULL DEFAULT 'Chikpeas',
    "siteSubtitle" TEXT,
    "logoUrl" TEXT,
    "accentColor" TEXT,
    "defaultTheme" "ThemePreference" NOT NULL DEFAULT 'DARK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepositorySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Greeting_characterId_hidden_idx" ON "Greeting"("characterId", "hidden");

-- CreateIndex
CREATE INDEX "Greeting_characterId_localPosition_idx" ON "Greeting"("characterId", "localPosition");
