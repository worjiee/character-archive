import { Pool } from "pg";
const PREVIEW_DATABASE_URL = "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true";
const BATCH_PROVENANCE = "large-catalog-preview-20260905";

const BASELINE_83_SET: ReadonlySet<string> = new Set([
  "013c0a00757bdda2dcef25d77c043616a9b93486afe1ea83e73bdd69953b5e4a",
  "065f36f97441198b90445de989552a210838b0e3e9dc70873fbbe90884ee8057",
  "0a228528e26182c7cf8f6eba16074e59bf0d95059a1038e3060276172ab01836",
  "0a50ff3ea9e237a8629dbc6094f9155f02eb62a6fe9c2350a8a84456518923f1",
  "13972a5b1400f35fa62f2d2b4e000a9408f728a02655c646cca16aeba2ad94f3",
  "18cef528bcfe0a698b4f3e4bc7049b36a3e2fd242d80693e1bf8f05bf6d39138",
  "19060549e6008b421fbb375444d43e829da7b0746b06e21f60210c740aff074a",
  "1d795dbba08ca20aadeeade496412175c9939ec49c813a1cbc93157066e503b1",
  "208b83ffcce268269d1ef3b933b822f5675ab2cec6dfdf40b02c1117ab9e19b1",
  "24c246ba4dee30a36294c8e8a01430d8eafbe78a4bcfb830ace37e9d84506281",
  "2537a77c30aa69293bea3a00f15ce9761bd905506d7f699b9c8bf6d5aa5cd39e",
  "25456964c7a0945837464b54d27365fd46136e74b3273ac349c0bd1dfd856ab7",
  "26ef82c11ef6b2a955f0011ba73c522a5231753ff9640e687d3459b556bc94dd",
  "3b9ea27f8f3bbde3262dc5d08b56d8be5c0b2865d8ae301c675b5c6c04235454",
  "3fbfc48e898c57ef4a6951c84e528bbd0f2eae9b0eb3f56b28bc302f57dfdc5c",
  "3fd76aaa93dfd4f84554dea810cd7fa008ef679a49ec1252c7bc46c789eaff15",
  "410ecb8c8e849d3500b493e563594f352cbf7ac259467a211247a9ae798dfe83",
  "4691f067d643bb81adfa839af0f2766c4a0b6d1d849d65be6d6ab00d50bc2b03",
  "46f53c4259018632223587bca14d0a5884fc1561d64d6166872bb9c58ee7edd9",
  "4898a7cca5014f7d97306a41cae9570c83141d8f86e6d2b9d71fdc8c4c6060b3",
  "4ebc981527cfdae79dd93efad1f83e19f5bf40b1dbfcd66dc883e7bef066c7ff",
  "519fcb8c07347b3a5624a56f5da4debc6a77bc462e6e431816322768506b16ba",
  "5325175b355a2367ef69b2bdb7f01d0fe24a6f7dd2ab92688207770e0b1ad4dc",
  "5328b248c61ca1652b2b583d2f6456d8e36eb693e3c2fe654e6381d5f69431ea",
  "5ddf1d4dae569ff27d518c908ffe6bc2b8e412b488aa07804f1029ec85bb7ae5",
  "5ed77a0c7e9fd98a96f9db517033a24fb7b838849ba23fa01ff73e5577dde836",
  "61185a4a2ce4dce57019a5f10dcab51042aeb63aa487e3223e675becc3dbcb59",
  "612f024a282dcdad4950c1042afb238b84c1cee9540bb7098bffb1c646741895",
  "6365ff217562a2d4348d25adb9b242db72a0ba5c096948149d0efdb8890ac2a4",
  "651907765e86bf854e3a6a05d713e61af7e1c3fafbf19d0ff31b05d066d39d29",
  "653b58df46d2f3df18af75cc4b4c506243212ea3a2125173c60d27c28ed5ad2c",
  "6a6b10f3aa0abe51cfa9e02473d7e878e8ba1ba7df6625411ce2c9a4a5665d6b",
  "6b450a777bff5cd9640e4b4f600af35b63d8fcf16bf8b02560d70ed7fbd6b037",
  "6dcb3f6109eb312079c91fe4f51e5de6a3cc8468363f83af24f9438d1a56a65d",
  "795b61a1d7e935f3b4c4969773739ad3c4dcf5ee9fdb7a4f0620d111a90c186a",
  "8320d470e4203843becc346a3353be02736dd4bb9053cfe0aca1b80a3158075a",
  "88143e57f0122f5f14bd066d059291d061cf21c79b197e3d659326feb82baecf",
  "8d64dc58415b48313396c12f5bcb897787a84a17a89b52705b24249351bae959",
  "8ec4c187707317044a2331d9b7a4301fe4c1cc20e62ccd3126f6bfbe3e06c034",
  "8f6e3e5a21b1a285870fd4fe44cdc6160d20431e0115dabf921badde3771f2ba",
  "98928b889a5093ded23abbb10d4907563cb3fe458f46c568269cfc68dca6dc62",
  "a09efb709a53e82e3955824c1bad68f72f46393505f15c43539127e1571fb42e",
  "a37db0b228e68f0676374231f1731a2c708fd8f5d2a2e180a572551bb4b71ae6",
  "a46fb0f6eb0669a38e9b142e0eb4510ddbd443f4c2f94c91575fe10e7920f96c",
  "a9bc33f42f5a389aca8ec4e0dc2aef549de396ddd35f59eebbc49ac51bf262bd",
  "ac188dd848bfa3cf70da7255ca4380aa6f7e7ca7ba374dc9dced2189c01f83dc",
  "b21c5149eb6198c991022e197145ad0246972f113197f6909470b08670aa70d7",
  "b2afb9cf19006e33afd34d008492e7edf8301315c3153a7dbd2e460d7e1bded0",
  "b492aa0aa1d8df128d08a9672bf23f01c8101333d3f5bb0339e16c44603daaf8",
  "b80d59efc1def3e655aa39685cb318a98e21d948d94e9889d465cd22de2c5311",
  "baa1b569e61a0416038821d8227060cbe0582fdadaae2562c2243c0b6e49c5a0",
  "bb0eec98999f039c28e88b2aca766ac31e3ec377e856b8937bf5be62f4c65e2c",
  "bce3f5d7d2327f1d06e59d15f6c58ea01e192c138091b703aeab274448f66b4e",
  "be9244fd94d722f247230407131874b1393179243f9bd92b6d7a965ab2ab26f6",
  "c44515288239c2132f2f44b9ce39643b4e783892ff45b2caffa2607fb4d710d4",
  "c48b93a5bdd9b3a313f3ca82e53ab00482de39ac3f2877217e52117c4b09ce71",
  "c81c6b29ba00c1aeb1c81ece42d6b613b166fdd000e5ab8e7de1bd72294df0b1",
  "caa889f13aaa58a7e3e2c1bd89b9cadf2473194ca5d0746e8a0b62af51bb45c9",
  "cacf08c0bac01d5764fd848e1e776fcaa268137022629504411a1d4ca8d06b70",
  "cef3f926eb43d6489402be867f14991535a7cd05fe6229bb447e087b6da21124",
  "da5c26b1c201d50a50f68eb0a6cbf5dbe18615301d557b46a3227472600c611d",
  "db72087a106554d670efe89be2d478831b7c40509fb0ab89428ef9daf574db29",
  "dbe7c7318237a2e70a83289127a4d4d470314d484ec11ca449d347c4dbb70334",
  "ded1164dd0f3eb8f92ea489df5ba3327f1f626784f7c9d4be631d71a6c4f8d26",
  "e172b463dacec9d45d59fa8ae1a13fb706b7336ca9ac2b7091d835c017c5244c",
  "e3556f0b01b70cae4a42a1a25228ee88767f77662300a11bc25a6b44dffb3e68",
  "e68b00155aaba59ae7fa237a27ee1162c843e5e4bb8813ea06dba71c08a7321f",
  "e6b4bbee3e7b4ac65c25fa5d0c6c818e66776e88e687115ddbb516e25328405d",
  "e9e908ae52df1780685540d874c6c45fc10b386877869addaef5ddd2ded3f81f",
  "ea39f6ad8b1aaf8f6c7e5abaa46300d09f367626927ae02532438ccf9acaae0b",
  "ea9a010e385f472d5d0e81ea644862984182fe548673527405cfd9164b2f2678",
  "eca6bbb2a4bc26e11314315126a7f1a922456462946c70f3f66d0f821c62e0e2",
  "eccf53236f775f9fe63a7eb0e68a61209f77f3d0920577018e4089cae07bc0ca",
  "efc17365615e46f9e8fd36376642102e5db1cbc01d321797cef3171b8501c128",
  "f12cf40c3d1b00756b12406d354b76301c382fbe60472f9ca72e4000fda5eabb",
  "f4cb497960b628203183ac6d0a20af22aefe05f48b856760d9da6c05fde7fea8",
  "f5badae539c05fb5377303a9a406a14654466df70f4eb7a74b56ae965230686f",
  "f64f9f0a7c2251ab31b8ae93c023b1dbd3d63dad25399e2eec7a472438f1037c",
  "f86418ae9caabe155ca58dabe06514e7285e94f00af5cb0e5e538af7b60f003d",
  "fa8f2367b262a3552cb7bb73f014dc1ec5b313b70ab98b2c1a4b07c78dc44b36",
  "fe9d5eb18f0193bdc0d9c519a51ab5af9ac05b34e1d495249cbd1e112d0ec29b",
  "ff0b9d4e82a5ae1ec39716043aec53bcda5310c822a6ef6d027bfcfb7d602d1f",
]);

async function rollbackLargeCatalog(): Promise<void> {
  const connectionString = process.env.DATABASE_URL || PREVIEW_DATABASE_URL;
  if (!connectionString.includes("aws-0-ap-southeast-1.pooler.supabase.com") || !connectionString.includes("ofdkiwwggzojofbxpxfr")) {
    throw new Error("GUARD TRIGGERED: Rollback can only be executed against the isolated Singapore Preview database.");
  }

  if (process.env.CONFIRM_ROLLBACK !== "yes" && !process.argv.includes("--confirm")) {
    throw new Error("GUARD TRIGGERED: Rollback requires explicit confirmation via --confirm or CONFIRM_ROLLBACK=yes.");
  }

  console.log("===============================================================");
  console.log("GUARDED ROLLBACK: Large Catalog Preview Batch (" + BATCH_PROVENANCE + ")");
  console.log("===============================================================");

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Identify characters belonging to the batch
    const batchChars = await client.query<{ id: string; artworkSha256: string | null }>(
      'SELECT id, "artworkSha256" FROM "Character" WHERE "contentFingerprint" = $1',
      [BATCH_PROVENANCE]
    );

    console.log(`Found ${batchChars.rowCount} characters belonging to batch ${BATCH_PROVENANCE}.`);

    if (batchChars.rowCount === 0) {
      console.log("No batch characters found. Nothing to rollback.");
      await client.query("ROLLBACK");
      return;
    }

    const charIds = batchChars.rows.map(r => r.id);

    // 2. Delete characters (cascades to CharacterSource, Greeting, CharacterTag, CharacterLorebook)
    const deleteCharsRes = await client.query(
      'DELETE FROM "Character" WHERE id = ANY($1)',
      [charIds]
    );
    console.log(`Deleted ${deleteCharsRes.rowCount} Character records.`);

    // 3. Clean up orphaned tags created by the batch
    const deleteTagsRes = await client.query(`
      DELETE FROM "Tag"
      WHERE id NOT IN (SELECT "tagId" FROM "CharacterTag")
        AND id NOT IN (SELECT "tagId" FROM "SourceTag")
    `);
    console.log(`Deleted ${deleteTagsRes.rowCount} orphaned Tag records.`);

    // 4. Clean up orphaned lorebooks created by the batch
    const deleteLorebooksRes = await client.query(`
      DELETE FROM "Lorebook"
      WHERE id NOT IN (SELECT "lorebookId" FROM "CharacterLorebook")
    `);
    console.log(`Deleted ${deleteLorebooksRes.rowCount} orphaned Lorebook records.`);

    // 5. Clean up artwork assets added for the batch that are not baseline
    const deleteArtworkRes = await client.query(`
      DELETE FROM "ArtworkAsset"
      WHERE sha256 NOT IN (SELECT "artworkSha256" FROM "Character" WHERE "artworkSha256" IS NOT NULL)
        AND NOT (sha256 = ANY($1))
    `, [Array.from(BASELINE_83_SET)]);
    console.log(`Deleted ${deleteArtworkRes.rowCount} orphaned ArtworkAsset records.`);

    // 6. Verify post-rollback counts
    const cCount = await client.query('SELECT count(*)::int as count FROM "Character"');
    const aCount = await client.query('SELECT count(*)::int as count FROM "ArtworkAsset"');
    const fCount = await client.query('SELECT count(*)::int as count FROM "CharacterFavorite"');
    const kCount = await client.query('SELECT count(*)::int as count FROM "CharacterCartItem"');

    console.log("\nPost-Rollback Invariant Verification:");
    console.log(`- Characters: ${cCount.rows[0].count} (must be 84)`);
    console.log(`- ArtworkAssets: ${aCount.rows[0].count} (must be 83)`);
    console.log(`- Favorites: ${fCount.rows[0].count} (must be 2)`);
    console.log(`- Cart: ${kCount.rows[0].count} (must be 2)`);

    if (cCount.rows[0].count !== 84 || aCount.rows[0].count !== 83 || fCount.rows[0].count !== 2 || kCount.rows[0].count !== 2) {
      throw new Error("Post-rollback invariants violated! Rolling back transaction.");
    }

    await client.query("COMMIT");
    console.log("\nRollback committed successfully. Catalog restored to baseline 84 characters / 83 artwork assets.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Rollback failed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].includes("rollback-large-catalog")) {
  rollbackLargeCatalog().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { rollbackLargeCatalog };
