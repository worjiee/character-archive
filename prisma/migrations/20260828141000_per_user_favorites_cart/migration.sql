-- Step 11C assigns every legacy single-owner collection row to the only
-- deterministic owner that existed before per-user collections.
DO $$
BEGIN
  IF (
    EXISTS (SELECT 1 FROM "CharacterFavorite")
    OR EXISTS (SELECT 1 FROM "CharacterCartItem")
  ) AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id" = 'initial-admin'
  ) THEN
    RAISE EXCEPTION 'Step 11C requires the initial-admin user before collection backfill';
  END IF;
END $$;

-- Add the ownership columns as nullable so existing timestamps and membership
-- rows remain in place during the deterministic backfill.
ALTER TABLE "CharacterFavorite" ADD COLUMN "userId" TEXT;
ALTER TABLE "CharacterCartItem" ADD COLUMN "userId" TEXT;

UPDATE "CharacterFavorite"
SET "userId" = 'initial-admin'
WHERE "userId" IS NULL;

UPDATE "CharacterCartItem"
SET "userId" = 'initial-admin'
WHERE "userId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CharacterFavorite" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Step 11C could not backfill every CharacterFavorite row';
  END IF;
  IF EXISTS (SELECT 1 FROM "CharacterCartItem" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Step 11C could not backfill every CharacterCartItem row';
  END IF;
END $$;

-- Replace the single-character identities only after every row has an owner.
ALTER TABLE "CharacterFavorite" DROP CONSTRAINT "CharacterFavorite_pkey";
ALTER TABLE "CharacterFavorite" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CharacterFavorite"
  ADD CONSTRAINT "CharacterFavorite_pkey" PRIMARY KEY ("userId", "characterId");

ALTER TABLE "CharacterCartItem" DROP CONSTRAINT "CharacterCartItem_pkey";
ALTER TABLE "CharacterCartItem" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CharacterCartItem"
  ADD CONSTRAINT "CharacterCartItem_pkey" PRIMARY KEY ("userId", "characterId");

DROP INDEX "CharacterFavorite_createdAt_idx";
DROP INDEX "CharacterCartItem_createdAt_idx";

CREATE INDEX "CharacterFavorite_userId_createdAt_idx"
  ON "CharacterFavorite"("userId", "createdAt");
CREATE INDEX "CharacterFavorite_characterId_idx"
  ON "CharacterFavorite"("characterId");
CREATE INDEX "CharacterCartItem_userId_createdAt_idx"
  ON "CharacterCartItem"("userId", "createdAt");
CREATE INDEX "CharacterCartItem_characterId_idx"
  ON "CharacterCartItem"("characterId");

ALTER TABLE "CharacterFavorite"
  ADD CONSTRAINT "CharacterFavorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CharacterCartItem"
  ADD CONSTRAINT "CharacterCartItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
