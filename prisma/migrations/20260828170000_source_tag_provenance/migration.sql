-- Step 11F: source-aware tag provenance.
--
-- Historical CharacterTag rows do not identify their original source. This
-- migration attributes each legacy row to the character's earliest source by
-- (firstSeenAt, id). The attribution is deterministic legacy provenance, not a
-- claim of historical source accuracy. Future source imports replace their own
-- SourceTag rows with observed provenance.

ALTER TABLE "Tag" ADD COLUMN "normalizedLabel" TEXT;

UPDATE "Tag"
SET "normalizedLabel" = lower(
  regexp_replace(
    regexp_replace(btrim(normalize("name", NFKC)), '\s+', ' ', 'g'),
    '^#\s*',
    ''
  )
);

ALTER TABLE "Tag" ALTER COLUMN "normalizedLabel" SET NOT NULL;

CREATE TABLE "SourceTag" (
  "characterSourceId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "rawLabel" TEXT NOT NULL,
  "normalizedLabel" TEXT NOT NULL,
  "externalId" TEXT,

  CONSTRAINT "SourceTag_pkey" PRIMARY KEY ("characterSourceId", "tagId")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CharacterTag" AS ct
    WHERE NOT EXISTS (
      SELECT 1
      FROM "CharacterSource" AS cs
      WHERE cs."characterId" = ct."characterId"
    )
  ) THEN
    RAISE EXCEPTION 'Step 11F cannot infer SourceTag provenance: a legacy CharacterTag has no CharacterSource';
  END IF;
END $$;

WITH earliest_sources AS (
  SELECT DISTINCT ON (cs."characterId")
    cs."characterId",
    cs."id" AS "characterSourceId"
  FROM "CharacterSource" AS cs
  ORDER BY cs."characterId", cs."firstSeenAt" ASC, cs."id" ASC
)
INSERT INTO "SourceTag" (
  "characterSourceId",
  "tagId",
  "rawLabel",
  "normalizedLabel",
  "externalId"
)
SELECT
  earliest_sources."characterSourceId",
  ct."tagId",
  tag."name",
  tag."normalizedLabel",
  NULL
FROM "CharacterTag" AS ct
JOIN earliest_sources
  ON earliest_sources."characterId" = ct."characterId"
JOIN "Tag" AS tag
  ON tag."id" = ct."tagId";

CREATE INDEX "Tag_normalizedLabel_idx" ON "Tag"("normalizedLabel");
CREATE INDEX "SourceTag_tagId_idx" ON "SourceTag"("tagId");
CREATE INDEX "SourceTag_normalizedLabel_idx" ON "SourceTag"("normalizedLabel");

ALTER TABLE "SourceTag"
  ADD CONSTRAINT "SourceTag_characterSourceId_fkey"
  FOREIGN KEY ("characterSourceId") REFERENCES "CharacterSource"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceTag"
  ADD CONSTRAINT "SourceTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "SourceTag" IS
  'Observed source-level tag provenance. Step 11F legacy rows are inferred from the earliest CharacterSource.';

COMMENT ON COLUMN "SourceTag"."rawLabel" IS
  'Source spelling preserved verbatim, including an optional leading #.';
