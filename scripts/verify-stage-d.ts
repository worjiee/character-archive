import fs from "node:fs";
import { Pool } from "pg";

const PREVIEW_DATABASE_URL = "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true";
const BATCH_PROVENANCE = "large-catalog-preview-20260905";

export interface VerificationResult {
  counts: Record<string, { actual: number; expected: number; match: boolean }>;
  batchCharactersCount: number;
  uniqueApprovedExternalIdsCount: number;
  validSourcesCount: number;
  charactersWithArtworkCount: number;
  artworklessCharactersCount: number;
  orphanArtworkCount: number;
  danglingCharTagsCount: number;
  danglingSourceTagsCount: number;
  danglingGreetingsCount: number;
  danglingCharLorebooksCount: number;
  lorebookEntriesCount: number;
  baselineEquivalence: {
    tested: number;
    identical: number;
    allMatch: boolean;
  };
  favoritesIntegrity: {
    count: number;
    charactersExist: boolean;
  };
  cartIntegrity: {
    count: number;
    charactersExist: boolean;
  };
  userSessions: number;
}

export async function runStageDVerification(): Promise<VerificationResult> {
  const pool = new Pool({ connectionString: PREVIEW_DATABASE_URL, max: 1 });
  const client = await pool.connect();

  try {
    console.log("===============================================================");
    console.log("STAGE D: MANDATORY POST-IMPORT INTEGRITY VERIFICATION");
    console.log("===============================================================\n");

    // 1. Table Counts
    const tables = [
      { name: "Character", expected: 355 },
      { name: "CharacterSource", expected: 355 },
      { name: "ArtworkAsset", expected: 354 },
      { name: "Tag", expected: 223 },
      { name: "SourceTag", expected: 2166 },
      { name: "CharacterTag", expected: 2166 },
      { name: "Greeting", expected: 990 },
      { name: "Lorebook", expected: 67 },
      { name: "LorebookEntry", expected: 327 },
      { name: "CharacterLorebook", expected: 225 },
      { name: "User", expected: 1 },
      { name: "CharacterFavorite", expected: 2 },
      { name: "CharacterCartItem", expected: 2 }
    ];

    const counts: Record<string, { actual: number; expected: number; match: boolean }> = {};
    for (const t of tables) {
      const res = await client.query<{ count: string }>(`SELECT count(*)::text as count FROM "${t.name}"`);
      const actual = Number(res.rows[0].count);
      counts[t.name] = { actual, expected: t.expected, match: actual === t.expected };
      console.log(`- ${t.name}: ${actual} (expected: ${t.expected}) ${actual === t.expected ? "✓" : "✗ MISMATCH"}`);
    }

    const sessionsRes = await client.query<{ count: string }>('SELECT count(*)::text as count FROM "UserSession"');
    const userSessions = Number(sessionsRes.rows[0].count);
    console.log(`- UserSession: ${userSessions} (active client/admin sessions reported)`);

    // 2. Prove exactly 271 imported Characters belong to batch large-catalog-preview-20260905
    const batchCharsRes = await client.query<{ count: string }>(
      'SELECT count(*)::text as count FROM "Character" WHERE "contentFingerprint" = $1',
      [BATCH_PROVENANCE]
    );
    const batchCharactersCount = Number(batchCharsRes.rows[0].count);
    console.log(`\n- Characters with batch provenance '${BATCH_PROVENANCE}': ${batchCharactersCount} (must be 271) ${batchCharactersCount === 271 ? "✓" : "✗"}`);

    // 3. Prove all 271 approved external IDs represented exactly once
    const batchSourcesRes = await client.query<{ externalId: string }>(`
      SELECT cs."externalId"
      FROM "CharacterSource" cs
      JOIN "Character" c ON c.id = cs."characterId"
      WHERE c."contentFingerprint" = $1
    `, [BATCH_PROVENANCE]);

    const importedExtIds = new Set(batchSourcesRes.rows.map(r => r.externalId));
    const uniqueApprovedExternalIdsCount = importedExtIds.size;
    console.log(`- Unique approved external IDs represented: ${uniqueApprovedExternalIdsCount}/271 ${uniqueApprovedExternalIdsCount === 271 ? "✓" : "✗"}`);

    // 4. All 355 Characters have valid CharacterSource relationships
    const validSourcesRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "Character" c
      JOIN "CharacterSource" cs ON cs."characterId" = c.id
    `);
    const validSourcesCount = Number(validSourcesRes.rows[0].count);
    console.log(`- Characters with valid CharacterSource: ${validSourcesCount}/355 ${validSourcesCount === 355 ? "✓" : "✗"}`);

    // 5. Exactly 354 Characters have artwork relationships (original 1 artwork-less character remains unchanged)
    const withArtRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "Character"
      WHERE "artworkSha256" IS NOT NULL
    `);
    const charactersWithArtworkCount = Number(withArtRes.rows[0].count);
    const artworklessRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "Character"
      WHERE "artworkSha256" IS NULL
    `);
    const artworklessCharactersCount = Number(artworklessRes.rows[0].count);
    console.log(`- Characters with ArtworkAsset relation: ${charactersWithArtworkCount}/354 ${charactersWithArtworkCount === 354 ? "✓" : "✗"}`);
    console.log(`- Characters without ArtworkAsset (original baseline): ${artworklessCharactersCount}/1 ${artworklessCharactersCount === 1 ? "✓" : "✗"}`);

    // 6. Zero orphan ArtworkAssets
    const orphanArtRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "ArtworkAsset" aa
      WHERE NOT EXISTS (
        SELECT 1 FROM "Character" c WHERE c."artworkSha256" = aa.sha256
      )
    `);
    const orphanArtworkCount = Number(orphanArtRes.rows[0].count);
    console.log(`- Orphan ArtworkAssets: ${orphanArtworkCount} (must be 0) ${orphanArtworkCount === 0 ? "✓" : "✗"}`);

    // 7. Zero dangling CharacterTag and SourceTag
    const danglingCharTagsRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "CharacterTag" ct
      WHERE NOT EXISTS (SELECT 1 FROM "Character" c WHERE c.id = ct."characterId")
         OR NOT EXISTS (SELECT 1 FROM "Tag" t WHERE t.id = ct."tagId")
    `);
    const danglingCharTagsCount = Number(danglingCharTagsRes.rows[0].count);
    console.log(`- Dangling CharacterTags: ${danglingCharTagsCount} (must be 0) ${danglingCharTagsCount === 0 ? "✓" : "✗"}`);

    const danglingSourceTagsRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "SourceTag" st
      WHERE NOT EXISTS (SELECT 1 FROM "CharacterSource" cs WHERE cs.id = st."characterSourceId")
         OR NOT EXISTS (SELECT 1 FROM "Tag" t WHERE t.id = st."tagId")
    `);
    const danglingSourceTagsCount = Number(danglingSourceTagsRes.rows[0].count);
    console.log(`- Dangling SourceTags: ${danglingSourceTagsCount} (must be 0) ${danglingSourceTagsCount === 0 ? "✓" : "✗"}`);

    // 8. Zero dangling Greetings
    const danglingGreetingsRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "Greeting" g
      WHERE NOT EXISTS (SELECT 1 FROM "Character" c WHERE c.id = g."characterId")
         OR NOT EXISTS (SELECT 1 FROM "CharacterSource" cs WHERE cs.id = g."characterSourceId")
    `);
    const danglingGreetingsCount = Number(danglingGreetingsRes.rows[0].count);
    console.log(`- Dangling Greetings: ${danglingGreetingsCount} (must be 0) ${danglingGreetingsCount === 0 ? "✓" : "✗"}`);

    // 9. Zero dangling CharacterLorebook relationships
    const danglingCharLorebooksRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "CharacterLorebook" cl
      WHERE NOT EXISTS (SELECT 1 FROM "Character" c WHERE c.id = cl."characterId")
         OR NOT EXISTS (SELECT 1 FROM "Lorebook" l WHERE l.id = cl."lorebookId")
    `);
    const danglingCharLorebooksCount = Number(danglingCharLorebooksRes.rows[0].count);
    console.log(`- Dangling CharacterLorebooks: ${danglingCharLorebooksCount} (must be 0) ${danglingCharLorebooksCount === 0 ? "✓" : "✗"}`);

    // 10. All 327 LorebookEntries belong to expected imported lorebooks
    const lorebookEntriesRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "LorebookEntry" le
      JOIN "Lorebook" l ON l.id = le."lorebookId"
      WHERE l."sourcePlatform" = 'JANITOR_AI'
    `);
    const lorebookEntriesCount = Number(lorebookEntriesRes.rows[0].count);
    console.log(`- Valid LorebookEntries attached to Lorebooks: ${lorebookEntriesCount}/327 ${lorebookEntriesCount === 327 ? "✓" : "✗"}`);

    // 11. Baseline 84 character equivalence check
    let identicalBaselineCount = 0;
    const baselineFile = "C:\\Users\\Karl\\.gemini\\antigravity\\brain\\9268bc27-8d7a-481b-b078-14e9174b997b\\scratch\\baseline-snapshot.json";
    if (fs.existsSync(baselineFile)) {
      const baselineData = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
      const baselineChars = baselineData.characters;

      for (const bc of baselineChars) {
        const currentRes = await client.query<{
          id: string;
          name: string;
          description: string | null;
          personality: string | null;
          scenario: string | null;
          avatarUrl: string | null;
          artworkSha256: string | null;
          status: string;
        }>('SELECT id, name, description, personality, scenario, "avatarUrl", "artworkSha256", status FROM "Character" WHERE id = $1', [bc.id]);

        if (currentRes.rowCount === 1) {
          const cur = currentRes.rows[0];
          if (
            cur.name === bc.name &&
            cur.description === bc.description &&
            cur.personality === bc.personality &&
            cur.scenario === bc.scenario &&
            cur.avatarUrl === bc.avatarUrl &&
            cur.artworkSha256 === bc.artworkSha256 &&
            cur.status === bc.status
          ) {
            identicalBaselineCount++;
          }
        }
      }
    }

    console.log(`- Baseline 84 Character Equivalence: ${identicalBaselineCount}/84 identical ${identicalBaselineCount === 84 ? "✓" : "✗"}`);

    // 12. Favorites and Cart integrity
    const favsRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "CharacterFavorite" cf
      JOIN "Character" c ON c.id = cf."characterId"
    `);
    const favoritesCount = Number(favsRes.rows[0].count);
    console.log(`- Favorites still referencing valid original characters: ${favoritesCount}/2 ${favoritesCount === 2 ? "✓" : "✗"}`);

    const cartRes = await client.query<{ count: string }>(`
      SELECT count(*)::text as count
      FROM "CharacterCartItem" cc
      JOIN "Character" c ON c.id = cc."characterId"
    `);
    const cartCount = Number(cartRes.rows[0].count);
    console.log(`- Cart items still referencing valid original characters: ${cartCount}/2 ${cartCount === 2 ? "✓" : "✗"}`);

    return {
      counts,
      batchCharactersCount,
      uniqueApprovedExternalIdsCount,
      validSourcesCount,
      charactersWithArtworkCount,
      artworklessCharactersCount,
      orphanArtworkCount,
      danglingCharTagsCount,
      danglingSourceTagsCount,
      danglingGreetingsCount,
      danglingCharLorebooksCount,
      lorebookEntriesCount,
      baselineEquivalence: {
        tested: 84,
        identical: identicalBaselineCount,
        allMatch: identicalBaselineCount === 84
      },
      favoritesIntegrity: {
        count: favoritesCount,
        charactersExist: favoritesCount === 2
      },
      cartIntegrity: {
        count: cartCount,
        charactersExist: cartCount === 2
      },
      userSessions
    };
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].includes("verify-stage-d")) {
  runStageDVerification().then((result) => {
    const allCountsMatch = Object.values(result.counts).every(c => c.match);
    const allInvariantsMatch =
      result.batchCharactersCount === 271 &&
      result.uniqueApprovedExternalIdsCount === 271 &&
      result.validSourcesCount === 355 &&
      result.charactersWithArtworkCount === 354 &&
      result.artworklessCharactersCount === 1 &&
      result.orphanArtworkCount === 0 &&
      result.danglingCharTagsCount === 0 &&
      result.danglingSourceTagsCount === 0 &&
      result.danglingGreetingsCount === 0 &&
      result.danglingCharLorebooksCount === 0 &&
      result.lorebookEntriesCount === 327 &&
      result.baselineEquivalence.allMatch &&
      result.favoritesIntegrity.charactersExist &&
      result.cartIntegrity.charactersExist;

    if (!allCountsMatch || !allInvariantsMatch) {
      console.error("\nSTAGE D VERIFICATION FAILED!");
      process.exit(1);
    } else {
      console.log("\n===============================================================");
      console.log("STAGE D VERIFICATION PASSED ALL INTEGRITY CHECKS!");
      console.log("===============================================================");
      process.exit(0);
    }
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
