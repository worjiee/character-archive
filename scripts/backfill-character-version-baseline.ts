import "dotenv/config";
import { Pool } from "pg";
import {
  buildCanonicalCharacterSnapshot,
  buildVersionFingerprintPayload,
  computeVersionFingerprint,
} from "../src/lib/characters/versions";
import { extractCcv2PromptFields } from "../src/lib/characters/tokens";

const PREVIEW_URL =
  process.env.PREVIEW_DATABASE_URL ||
  (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? process.env.DATABASE_URL
    : "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true");

export interface BackfillSummary {
  totalCharacters: number;
  alreadyBackfilled: number;
  candidatesToBackfill: number;
  successfulBackfills: number;
  errors: Array<{ characterId: string; error: string }>;
}

export async function runBaselineBackfill(options: { write: boolean }): Promise<BackfillSummary> {
  const { write } = options;
  const pool = new Pool({
    connectionString: PREVIEW_URL,
    max: 2,
    connectionTimeoutMillis: 15000,
  });

  try {
    console.log(`\n======================================================`);
    console.log(`Starting High-Performance Character Version Baseline Backfill`);
    console.log(`Mode: ${write ? "WRITE (PERSIST TO DB)" : "DRY-RUN (VALIDATE ONLY)"}`);
    console.log(`======================================================\n`);

    const tStart = Date.now();
    const client = await pool.connect();

    // 1. Bulk queries
    console.log(`Fetching catalog entities via bulk queries...`);
    const charsRes = await client.query(`
      SELECT id, name, "nameOverride", description, "descriptionOverride",
             personality, "personalityOverride", scenario, "scenarioOverride",
             "exampleDialogs", "avatarUrl", "avatarUrlOverride", "artworkSha256",
             "tokenCount", "permanentTokenCount", "firstAddedByUserId",
             "createdAt", "currentVersionNumber", "currentVersionFingerprint"
      FROM "Character"
      ORDER BY "createdAt" ASC
    `);
    const greetingsRes = await client.query(`
      SELECT id, "characterId", content, position, "localPosition", hidden, "externalId"
      FROM "Greeting"
      ORDER BY "characterId" ASC, "localPosition" ASC, position ASC
    `);
    const tagsRes = await client.query(`
      SELECT ct."characterId", t.name, t.slug
      FROM "CharacterTag" ct
      JOIN "Tag" t ON t.id = ct."tagId"
      ORDER BY ct."characterId" ASC, t.slug ASC
    `);
    const lorebooksRes = await client.query(`
      SELECT cl."characterId", l.id, l."externalId", l.title, l.description,
             l."sourcePlatform", l."sourceUrl"
      FROM "CharacterLorebook" cl
      JOIN "Lorebook" l ON l.id = cl."lorebookId"
      ORDER BY cl."characterId" ASC, l."externalId" ASC
    `);
    const lorebookEntriesRes = await client.query(`
      SELECT le."lorebookId", le."externalEntryId", le.content, le.keys,
             le.category, le.comment, le."caseSensitive", le."activationMode",
             le."groupWeight", le.enabled, le.constant, le."insertionOrder"
      FROM "LorebookEntry" le
      ORDER BY le."lorebookId" ASC, le."insertionOrder" ASC, le."externalEntryId" ASC
    `);
    const sourcesRes = await client.query(`
      SELECT id, "characterId", platform, "externalId", "externalCreatorId",
             "creatorName", "sourceUrl", "sourceCreatedAt", "sourceUpdatedAt",
             "rawData"
      FROM "CharacterSource"
      ORDER BY "characterId" ASC, platform ASC, "externalId" ASC
    `);
    const existingVersionsRes = await client.query(`
      SELECT "characterId", "versionNumber", fingerprint
      FROM "CharacterVersion"
      WHERE "versionNumber" = 1
    `);
    const artworksRes = await client.query(`
      SELECT sha256 FROM "ArtworkAsset"
    `);

    console.log(`Fetched catalog entities in ${Date.now() - tStart} ms:`);
    console.log(`- Characters:        ${charsRes.rowCount}`);
    console.log(`- Greetings:         ${greetingsRes.rowCount}`);
    console.log(`- CharacterTags:     ${tagsRes.rowCount}`);
    console.log(`- CharacterLorebooks:${lorebooksRes.rowCount}`);
    console.log(`- LorebookEntries:   ${lorebookEntriesRes.rowCount}`);
    console.log(`- CharacterSources:  ${sourcesRes.rowCount}`);
    console.log(`- Existing v1 rows:  ${existingVersionsRes.rowCount}`);
    console.log(`- ArtworkAssets:     ${artworksRes.rowCount}`);

    // Pre-validation: verify all distinct artworkSha256 exist
    const existingArtworkSet = new Set(artworksRes.rows.map((r) => r.sha256));
    const missingArtworks: string[] = [];
    for (const char of charsRes.rows) {
      if (char.artworkSha256 && !existingArtworkSet.has(char.artworkSha256)) {
        missingArtworks.push(char.artworkSha256);
      }
    }
    if (missingArtworks.length > 0) {
      throw new Error(`Pre-validation failed: missing artwork assets for ${missingArtworks.length} characters`);
    }
    console.log(`Pre-validation passed: all artwork assets verified.`);

    // 2. Build in-memory lookup maps
    const greetingsByChar = new Map<string, typeof greetingsRes.rows>();
    for (const g of greetingsRes.rows) {
      const list = greetingsByChar.get(g.characterId) ?? [];
      list.push(g);
      greetingsByChar.set(g.characterId, list);
    }

    const tagsByChar = new Map<string, typeof tagsRes.rows>();
    for (const t of tagsRes.rows) {
      const list = tagsByChar.get(t.characterId) ?? [];
      list.push(t);
      tagsByChar.set(t.characterId, list);
    }

    const entriesByLorebook = new Map<string, typeof lorebookEntriesRes.rows>();
    for (const e of lorebookEntriesRes.rows) {
      const list = entriesByLorebook.get(e.lorebookId) ?? [];
      list.push(e);
      entriesByLorebook.set(e.lorebookId, list);
    }

    type RawLorebookItem = NonNullable<Parameters<typeof buildCanonicalCharacterSnapshot>[0]["lorebooks"]>[number];
    const lorebooksByChar = new Map<string, RawLorebookItem[]>();
    for (const l of lorebooksRes.rows) {
      const list = lorebooksByChar.get(l.characterId) ?? [];
      list.push({
        externalId: l.externalId,
        title: l.title,
        description: l.description,
        sourcePlatform: l.sourcePlatform,
        sourceUrl: l.sourceUrl,
        entries: (entriesByLorebook.get(l.id) ?? []).map((e) => ({
          externalEntryId: e.externalEntryId,
          content: e.content,
          keys: e.keys ?? [],
          category: e.category,
          comment: e.comment,
          caseSensitive: e.caseSensitive,
          activationMode: e.activationMode,
          groupWeight: e.groupWeight,
          enabled: e.enabled,
          constant: e.constant,
          insertionOrder: e.insertionOrder,
        })),
      });
      lorebooksByChar.set(l.characterId, list);
    }

    const sourcesByChar = new Map<string, typeof sourcesRes.rows>();
    for (const s of sourcesRes.rows) {
      const list = sourcesByChar.get(s.characterId) ?? [];
      list.push(s);
      sourcesByChar.set(s.characterId, list);
    }

    const existingV1ByChar = new Map<string, string>();
    for (const v of existingVersionsRes.rows) {
      existingV1ByChar.set(v.characterId, v.fingerprint);
    }

    // 3. Process each character in memory
    const summary: BackfillSummary = {
      totalCharacters: charsRes.rowCount ?? 0,
      alreadyBackfilled: 0,
      candidatesToBackfill: 0,
      successfulBackfills: 0,
      errors: [],
    };

    const now = new Date();
    const candidates: Array<{
      charId: string;
      userId: string | null;
      snapshot: ReturnType<typeof buildCanonicalCharacterSnapshot>;
      fingerprint: string;
    }> = [];

    for (const char of charsRes.rows) {
      try {
        const charGreetings = greetingsByChar.get(char.id) ?? [];
        const charTags = tagsByChar.get(char.id) ?? [];
        const charLorebooks = lorebooksByChar.get(char.id) ?? [];
        const charSources = sourcesByChar.get(char.id) ?? [];

        let systemPrompt: string | null = null;
        let postHistoryInstructions: string | null = null;
        for (const s of charSources) {
          if (s.rawData) {
            const extracted = extractCcv2PromptFields(s.rawData);
            if (extracted.systemPrompt || extracted.postHistoryInstructions) {
              systemPrompt = extracted.systemPrompt;
              postHistoryInstructions = extracted.postHistoryInstructions;
              break;
            }
          }
        }

        const snapshot = buildCanonicalCharacterSnapshot({
          name: char.name,
          nameOverride: char.nameOverride,
          description: char.description,
          descriptionOverride: char.descriptionOverride,
          personality: char.personality,
          personalityOverride: char.personalityOverride,
          scenario: char.scenario,
          scenarioOverride: char.scenarioOverride,
          exampleDialogs: char.exampleDialogs,
          avatarUrl: char.avatarUrl,
          avatarUrlOverride: char.avatarUrlOverride,
          artworkSha256: char.artworkSha256,
          tokenCount: char.tokenCount,
          permanentTokenCount: char.permanentTokenCount,
          createdAt: char.createdAt,
          capturedAt: now,
          systemPrompt,
          postHistoryInstructions,
          greetings: charGreetings,
          tags: charTags,
          lorebooks: charLorebooks,
          sources: charSources,
        });

        const fingerprintPayload = buildVersionFingerprintPayload({
          name: char.name,
          nameOverride: char.nameOverride,
          description: char.description,
          descriptionOverride: char.descriptionOverride,
          personality: char.personality,
          personalityOverride: char.personalityOverride,
          scenario: char.scenario,
          scenarioOverride: char.scenarioOverride,
          exampleDialogs: char.exampleDialogs,
          avatarUrl: char.avatarUrl,
          avatarUrlOverride: char.avatarUrlOverride,
          systemPrompt,
          postHistoryInstructions,
          artworkSha256: char.artworkSha256,
          greetings: charGreetings,
          tags: charTags,
          lorebooks: charLorebooks,
          sources: charSources,
        });

        const fingerprint = computeVersionFingerprint(fingerprintPayload);

        // Determinism check
        const recomputed = computeVersionFingerprint(fingerprintPayload);
        if (recomputed !== fingerprint) {
          throw new Error(`Determinism check failed for character ${char.id}`);
        }

        const existingFingerprint = existingV1ByChar.get(char.id);
        if (existingFingerprint) {
          summary.alreadyBackfilled++;
        } else {
          summary.candidatesToBackfill++;
          candidates.push({
            charId: char.id,
            userId: char.firstAddedByUserId,
            snapshot,
            fingerprint,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push({ characterId: char.id, error: msg });
      }
    }

    console.log(`\nIn-memory processing complete in ${Date.now() - tStart} ms:`);
    console.log(`- Total characters:       ${summary.totalCharacters}`);
    console.log(`- Already backfilled v1:  ${summary.alreadyBackfilled}`);
    console.log(`- Candidates to insert:   ${summary.candidatesToBackfill}`);
    console.log(`- Pre-check errors:       ${summary.errors.length}`);

    if (summary.errors.length > 0) {
      console.error(`Errors encountered:`, summary.errors.slice(0, 5));
      client.release();
      return summary;
    }

    // 4. In WRITE mode, insert and update in transactions of 50
    if (write && candidates.length > 0) {
      console.log(`\nExecuting batched writes in chunks of 50...`);
      const BATCH_SIZE = 50;

      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        await client.query("BEGIN");
        try {
          for (const item of batch) {
            const id = `cuid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            await client.query(
              `INSERT INTO "CharacterVersion" (
                id, "characterId", "versionNumber", fingerprint, "snapshotSchemaVersion",
                origin, snapshot, "changeSummary", "artworkSha256", "tokenCount",
                "permanentTokenCount", "createdById", "createdAt"
              ) VALUES (
                $1, $2, $3, $4, $5, $6::"CharacterVersionOrigin", $7, $8, $9, $10, $11, $12, $13
              )`,
              [
                id,
                item.charId,
                1,
                item.fingerprint,
                1,
                "BASELINE",
                JSON.stringify(item.snapshot),
                "Initial archive baseline",
                item.snapshot.artwork.sha256,
                item.snapshot.tokenMetrics.tokenCount,
                item.snapshot.tokenMetrics.permanentTokenCount,
                item.userId,
                now,
              ]
            );

            await client.query(
              `UPDATE "Character"
               SET "currentVersionNumber" = 1,
                   "currentVersionFingerprint" = $1
               WHERE id = $2`,
              [item.fingerprint, item.charId]
            );
          }
          await client.query("COMMIT");
          summary.successfulBackfills += batch.length;
          console.log(`  Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${summary.successfulBackfills}/${candidates.length})`);
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        }
      }
    }

    // 5. Post-validation
    if (write) {
      console.log(`\nRunning post-write validation...`);
      const vCount = await client.query(`SELECT count(*)::int as count FROM "CharacterVersion"`);
      const cMissing = await client.query(`
        SELECT count(*)::int as count FROM "Character"
        WHERE "currentVersionNumber" != 1 OR "currentVersionFingerprint" IS NULL
      `);

      console.log(`- Total CharacterVersion rows in DB: ${vCount.rows[0].count}`);
      console.log(`- Characters without valid v1 state: ${cMissing.rows[0].count}`);

      if (vCount.rows[0].count < summary.totalCharacters || cMissing.rows[0].count > 0) {
        throw new Error(
          `Post-validation failed: total versions (${vCount.rows[0].count}) < characters (${summary.totalCharacters}) or missing (${cMissing.rows[0].count})`
        );
      }
      console.log(`Post-validation PASSED! 100% of characters have authoritative baseline v1.`);
    }

    client.release();
    return summary;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const write = process.argv.includes("--write") || process.argv.includes("--execute");
  runBaselineBackfill({ write })
    .then((summary) => {
      if (summary.errors.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed with unhandled error:", err);
      process.exit(1);
    });
}
