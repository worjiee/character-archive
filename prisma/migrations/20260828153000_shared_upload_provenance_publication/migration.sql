-- Step 11E keeps shared archive records when an uploader is revoked. User rows
-- remain durable, and both provenance foreign keys therefore use RESTRICT.
-- Attribution columns are staged as nullable so existing archive rows can be
-- backfilled without replacing records or changing their timestamps.
ALTER TABLE "Character"
  ADD COLUMN "firstAddedByUserId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "CharacterSource"
  ADD COLUMN "firstAddedByUserId" TEXT;

-- Existing shared records predate multi-user uploads, so initial-admin is the
-- only truthful deterministic attribution. Fail closed rather than inventing
-- provenance if that account is unavailable.
DO $$
BEGIN
  IF (
    EXISTS (SELECT 1 FROM "Character")
    OR EXISTS (SELECT 1 FROM "CharacterSource")
  ) AND NOT EXISTS (
    SELECT 1
    FROM "User"
    WHERE "id" = 'initial-admin'
      AND "role" = 'ADMIN'
      AND "accessStatus" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Step 11E requires the active initial-admin user before provenance backfill';
  END IF;
END $$;

UPDATE "Character"
SET "firstAddedByUserId" = 'initial-admin'
WHERE "firstAddedByUserId" IS NULL;

UPDATE "CharacterSource"
SET "firstAddedByUserId" = 'initial-admin'
WHERE "firstAddedByUserId" IS NULL;

-- A legacy ACTIVE row was already visible to ordinary users. Its first
-- publication therefore equals its original archive creation time. Restricted
-- rows remain unpublished until an explicit future approval.
UPDATE "Character"
SET "publishedAt" = "createdAt"
WHERE "status" = 'ACTIVE'
  AND "publishedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Character" WHERE "firstAddedByUserId" IS NULL) THEN
    RAISE EXCEPTION 'Step 11E could not backfill every Character row';
  END IF;
  IF EXISTS (SELECT 1 FROM "CharacterSource" WHERE "firstAddedByUserId" IS NULL) THEN
    RAISE EXCEPTION 'Step 11E could not backfill every CharacterSource row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Character"
    WHERE "status" = 'ACTIVE' AND "publishedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Step 11E could not publish every legacy ACTIVE character';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Character"
    WHERE "status" <> 'ACTIVE' AND "publishedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Step 11E unexpectedly published a restricted legacy character';
  END IF;
END $$;

ALTER TABLE "Character"
  ALTER COLUMN "firstAddedByUserId" SET NOT NULL;

ALTER TABLE "CharacterSource"
  ALTER COLUMN "firstAddedByUserId" SET NOT NULL;

CREATE INDEX "Character_status_publishedAt_idx"
  ON "Character"("status", "publishedAt");

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_firstAddedByUserId_fkey"
  FOREIGN KEY ("firstAddedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CharacterSource"
  ADD CONSTRAINT "CharacterSource_firstAddedByUserId_fkey"
  FOREIGN KEY ("firstAddedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
