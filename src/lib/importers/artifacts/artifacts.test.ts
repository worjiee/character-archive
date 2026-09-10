import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  ARTIFACT_LIMITS,
  ArtifactImportError,
  assertPngByteLength,
  extractCcv2FromPng,
  inspectArtifact,
  inspectExtractorZip,
  validateDeclaredArchiveBounds,
} from ".";

const JANITOR_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

describe("production ZIP and Character Card import", () => {
  it("validates a standalone CCv2 PNG, preserves # tags, and derives Janitor identity only from the full UUID", () => {
    const result = inspectArtifact(cardPng(card({ janitorId: JANITOR_ID })), "Theron.png");
    expect(result.kind).toBe("PNG");
    expect(result.items[0]).toMatchObject({
      status: "READY",
      artworkPolicy: "PREPARED_UPLOADED_ARTWORK",
      character: {
        externalId: JANITOR_ID,
        platform: "JANITOR_AI",
        sourceUrl: `https://janitorai.com/characters/${JANITOR_ID}`,
        tags: [{ name: "#Fantasy", slug: "fantasy" }],
      },
      artwork: {
        metadata: {
          mediaType: "image/png",
          width: 1,
          height: 1,
        },
      },
    });
    const artwork = result.items[0].artwork!;
    expect(artwork.metadata.sha256).toBe(createHash("sha256").update(artwork.readBytes()).digest("hex"));
    expect(artwork.metadata.byteLength).toBe(artwork.readBytes().byteLength);
  });

  it("uses the shared prose policy for ZIP and standalone PNG previews", () => {
    const value = card({ janitorId: JANITOR_ID });
    Object.assign(value.data, {
      description: '<p>Readable &amp; safe</p><img src="x" onerror="bad()"><script>alert(1)</script>',
      personality: "<strong>Wide personality</strong>",
      scenario: "First<br>Second",
      mes_example: '<a href="javascript:bad()">Visible dialog</a>',
      first_mes: "<p>Hello</p>",
    });
    const normalized = inspectArtifact(cardPng(value), "card.png").items[0].character!;
    expect(normalized).toMatchObject({
      description: "Readable & safe",
      personality: "Wide personality",
      scenario: "First\nSecond",
      exampleDialogs: "Visible dialog",
      greetings: expect.arrayContaining([expect.objectContaining({ content: "Hello" })]),
    });
  });

  it("keeps source-neutral CCv2 cards source neutral with stable content identity", () => {
    const png = cardPng(card());
    const first = inspectArtifact(png, "one.png").items[0].character!;
    const second = inspectArtifact(png, "renamed.png").items[0].character!;
    expect(first.platform).toBe("OTHER");
    expect(first.externalId).toMatch(/^ccv2-[0-9a-f]{64}$/);
    expect(second.externalId).toBe(first.externalId);
    expect(first.sourceUrl).toBe(`urn:character-card:sha256:${first.externalId.slice(5)}`);
  });

  it("reads extractor order/grouping, cross-checks the manifest, and isolates a bad card", () => {
    const zip = zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 2 })),
      [`001_Alpha_${JANITOR_ID.slice(0, 8)}.png`]: cardPng(card({ name: "Alpha", janitorId: JANITOR_ID })),
      "002_Bad_aaaaaaaa.png": Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    });
    const result = inspectExtractorZip(zip);
    expect(result.manifest.crossCheck).toBe("MATCHED");
    expect(result.items.map((item) => item.status)).toEqual(["READY", "INVALID"]);
    expect(result.items[0].character?.name).toBe("Alpha");
  });

  it("marks exact extractor fallback TXT for review rather than guessing reconstructed fields", () => {
    const value = card({ name: "Private", janitorId: JANITOR_ID });
    ((value.data as Record<string, unknown>).extensions as { janitorai: Record<string, unknown> }).janitorai.showdefinition = false;
    const fallback = fallbackText(value, "unstructured private prose");
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Private_d7745ac8.png": basePng(),
      "001_Private_d7745ac8.txt": strToU8(fallback),
    }));
    expect(result.items[0]).toMatchObject({
      filename: "001_Private_d7745ac8.txt",
      status: "FALLBACK_REVIEW_REQUIRED",
      code: "FALLBACK_REVIEW_REQUIRED",
      fallback: {
        displayName: "Private",
        exportIndex: 1,
        source: { platform: "JANITOR_AI", externalId: JANITOR_ID, definitionHidden: true },
        artifacts: { txt: true, png: true, worldInfoFiles: 0 },
        artwork: { metadata: { mediaType: "image/png", width: 1, height: 1 } },
        referenceSections: [{ title: "RECONSTRUCTED CARD (from generateAlpha probe)", content: "unstructured private prose" }],
      },
      artworkPolicy: "PREPARED_UPLOADED_ARTWORK",
    });
    expect(result.items[0].character).toBeUndefined();
  });

  it("strictly parses deterministically associated SillyTavern World Info without creating another character", () => {
    const fallback = fallbackText(card({ name: "Example", janitorId: JANITOR_ID }), "reference text");
    const worldInfo = { entries: { "0": { key: ["castle"], keysecondary: ["keep"], content: "Bounded lore", comment: "Castle", order: 7 } } };
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "059_Example_d7745ac8.png": basePng(),
      "059_Example_d7745ac8.txt": strToU8(fallback),
      "059_Example_d7745ac8_lorebook_worldinfo.json": strToU8(JSON.stringify(worldInfo)),
    }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].fallback).toMatchObject({
      displayName: "Example",
      artifacts: { png: true, worldInfoFiles: 1 },
      lorebooks: [{ title: "Example lorebook", entries: [{ keys: ["castle", "keep"], content: "Bounded lore", insertionOrder: 7 }] }],
    });
  });

  it("rejects malformed partial metadata and invalid associated World Info with safe codes", () => {
    const malformed = ["CHARACTER CARD V2 (PARTIAL — from API metadata)", "{bad"].join("\n");
    const malformedResult = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Bad_deadbeef.txt": strToU8(malformed),
    }));
    expect(malformedResult.items[0]).toMatchObject({ status: "INVALID", code: "PARTIAL_METADATA_INVALID" });

    const invalidLorebook = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Private_d7745ac8.txt": strToU8(fallbackText(card({ name: "Private", janitorId: JANITOR_ID }), "reference")),
      "001_Private_d7745ac8_lorebook_worldinfo.json": strToU8(JSON.stringify({ entries: [] })),
    }));
    expect(invalidLorebook.items[0]).toMatchObject({ status: "INVALID", code: "LOREBOOK_INVALID" });
  });

  it("associates embedded extractor lorebook entries by full lorebook ID", () => {
    const value = card({ janitorId: JANITOR_ID });
    const data = value.data as Record<string, unknown>;
    data.character_book = {
      name: "World",
      extensions: { janitorai: { lorebooks: [{ id: "lore-1", title: "World" }] } },
      entries: [{
        keys: ["castle"], content: "A bounded entry", enabled: true, insertion_order: 0,
        extensions: { janitorai: { lorebook_id: "lore-1", source_id: "entry-1" } },
      }],
    };
    const character = inspectArtifact(cardPng(value), "card.png").items[0].character!;
    expect(character.lorebookReferences).toEqual([{ externalId: "lore-1", title: "World" }]);
    expect(character.embeddedLorebooks?.[0]).toMatchObject({
      externalId: "lore-1",
      entries: [{ externalEntryId: "entry-1", keys: ["castle"], content: "A bounded entry" }],
    });
  });

  it("converges a CCv2 reference and creator-archive script by source identity despite title casing", () => {
    const value = card({ janitorId: JANITOR_ID });
    (value.data as Record<string, unknown>).character_book = {
      name: "DKU locations & clubs",
      extensions: { janitorai: { lorebooks: [{ id: "same-id", title: "DKU locations & clubs" }] } },
      entries: [{
        keys: ["campus"], content: "Embedded copy", enabled: true,
        extensions: { janitorai: { lorebook_id: "same-id", source_id: "entry-1" } },
      }],
    };
    const archiveLorebook = {
      source: "janitorai",
      id: "same-id",
      title: "DKU Locations & Clubs",
      entries: [{
        id: "entry-1", key: ["campus"], content: "Authoritative archive copy",
      }],
    };
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Card_d7745ac8.png": cardPng(value),
      "_lorebooks/script_same-id.json": strToU8(JSON.stringify(archiveLorebook)),
    }));
    const character = result.items[0].character!;
    expect(character.lorebookReferences).toEqual([{ externalId: "same-id", title: "DKU Locations & Clubs" }]);
    expect(character.embeddedLorebooks).toHaveLength(1);
    expect(character.embeddedLorebooks?.[0]).toMatchObject({
      platform: "JANITOR_AI",
      externalId: "same-id",
      title: "DKU Locations & Clubs",
      entries: [{ externalEntryId: "entry-1", content: "Authoritative archive copy" }],
    });
  });

  it("keeps equal titles with different proven source IDs separate", () => {
    const value = card({ janitorId: JANITOR_ID });
    (value.data as Record<string, unknown>).character_book = {
      name: "Shared title",
      extensions: { janitorai: { lorebooks: [
        { id: "source-one", title: "Shared title" },
        { id: "source-two", title: "Shared title" },
      ] } },
      entries: [
        { keys: ["one"], content: "First", extensions: { janitorai: { lorebook_id: "source-one", source_id: "entry-one" } } },
        { keys: ["two"], content: "Second", extensions: { janitorai: { lorebook_id: "source-two", source_id: "entry-two" } } },
      ],
    };
    const character = inspectArtifact(cardPng(value), "card.png").items[0].character!;
    expect(character.embeddedLorebooks?.map(({ externalId }) => externalId)).toEqual(["source-one", "source-two"]);
  });

  it("fails closed when matching card and archive identities disagree on source platform", () => {
    const value = card({ janitorId: JANITOR_ID });
    (value.data as Record<string, unknown>).character_book = {
      name: "World",
      extensions: { janitorai: { lorebooks: [{ id: "same-id", title: "World" }] } },
      entries: [{
        keys: [], content: "Entry",
        extensions: { janitorai: { lorebook_id: "same-id", source_id: "one" } },
      }],
    };
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Card_d7745ac8.png": cardPng(value),
      "_lorebooks/script_same-id.json": strToU8(JSON.stringify({ source: "other", id: "same-id", title: "World", entries: [] })),
    }));
    expect(result.items[0]).toMatchObject({ status: "LOREBOOK_AMBIGUOUS", code: "LOREBOOK_AMBIGUOUS" });
  });

  it("rejects ambiguous multi-lorebook entries instead of guessing associations", () => {
    const value = card({ janitorId: JANITOR_ID });
    (value.data as Record<string, unknown>).character_book = {
      name: "Combined",
      extensions: { janitorai: { lorebooks: [{ id: "one" }, { id: "two" }] } },
      entries: [{ keys: [], content: "No source ID" }],
    };
    expect(() => inspectArtifact(cardPng(value), "card.png")).toThrowError(expect.objectContaining({ code: "LOREBOOK_AMBIGUOUS" }));
  });

  it("isolates duplicate archive lorebook IDs as an association ambiguity", () => {
    const value = card({ janitorId: JANITOR_ID });
    (value.data as Record<string, unknown>).character_book = {
      name: "World",
      extensions: { janitorai: { lorebooks: [{ id: "same-id", title: "World" }] } },
      entries: [{ keys: [], content: "Entry", extensions: { janitorai: { lorebook_id: "same-id", source_id: "one" } } }],
    };
    const lorebook = JSON.stringify({ source: "janitorai", id: "same-id", title: "World", entries: [] });
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_Card_d7745ac8.png": cardPng(value),
      "_lorebooks/World_one.json": strToU8(lorebook),
      "_lorebooks/World_two.json": strToU8(lorebook),
    }));
    expect(result.items[0]).toMatchObject({ status: "LOREBOOK_AMBIGUOUS", code: "LOREBOOK_AMBIGUOUS" });
  });

  it("rejects zip-slip paths, duplicate canonical paths, encrypted flags, and suspicious ratios", () => {
    expectCode(() => inspectExtractorZip(zipSync({ "../evil.txt": strToU8("x") })), "ARCHIVE_UNSAFE_PATH");
    expectCode(() => inspectExtractorZip(zipSync({ "A.txt": strToU8("x"), "a.txt": strToU8("y") })), "ARCHIVE_DUPLICATE_PATH");

    const encrypted = zipSync({ "001_A_d7745ac8.txt": strToU8("x") });
    const central = findSignature(encrypted, 0x02014b50);
    encrypted[central + 8] |= 1;
    expectCode(() => inspectExtractorZip(encrypted), "ARCHIVE_ENCRYPTED");

    expectCode(() => inspectExtractorZip(zipSync({ "001_A_d7745ac8.txt": new Uint8Array(200_000) }, { level: 9 })), "ARCHIVE_COMPRESSION_RATIO");
    expectCode(() => inspectExtractorZip(zipSync({ "nested.zip": strToU8("not allowed") })), "ARCHIVE_INVALID");
  });

  it("accepts realistic PNG sizes above 10 MiB through the type-specific central-directory policy", () => {
    const oneMiB = 1024 * 1024;
    for (const size of [10 * oneMiB + 1, 32 * oneMiB - 1, 32 * oneMiB]) {
      expect(() => validateDeclaredArchiveBounds([{ path: "card.png", compressedSize: size, uncompressedSize: size }])).not.toThrow();
      expect(() => assertPngByteLength(size, "card.png")).not.toThrow();
    }
  });

  it("rejects PNG, JSON, TXT, and unknown entries at their distinct bounded ceilings", () => {
    const oneMiB = 1024 * 1024;
    expectCode(() => assertPngByteLength(32 * oneMiB + 1, "large.png"), "ARCHIVE_ENTRY_TOO_LARGE");
    expect(() => validateDeclaredArchiveBounds([{
      path: "folder/large.png",
      compressedSize: 32 * oneMiB + 1,
      uncompressedSize: 32 * oneMiB + 1,
    }])).toThrowError(expect.objectContaining({
      code: "ARCHIVE_ENTRY_TOO_LARGE",
      message: "Character Card PNG exceeds the 32 MiB per-file limit: large.png",
    }));
    for (const path of ["metadata.json", "fallback.txt", "unknown.bin"]) {
      expectCode(() => validateDeclaredArchiveBounds([{
        path,
        compressedSize: 2 * oneMiB + 1,
        uncompressedSize: 2 * oneMiB + 1,
      }]), "ARCHIVE_ENTRY_TOO_LARGE");
    }
  });

  it("keeps expanded-total and compression-ratio defenses independent of the larger PNG ceiling", () => {
    const oneMiB = 1024 * 1024;
    const expandedTooLarge = Array.from({ length: 33 }, (_, index) => ({
      path: `${index}.png`,
      compressedSize: 32 * oneMiB,
      uncompressedSize: 32 * oneMiB,
    }));
    expectCode(() => validateDeclaredArchiveBounds(expandedTooLarge), "ARCHIVE_TOO_LARGE");
    expectCode(() => validateDeclaredArchiveBounds([{
      path: "ratio.png",
      compressedSize: 1,
      uncompressedSize: ARTIFACT_LIMITS.compressionRatio + 1,
    }]), "ARCHIVE_COMPRESSION_RATIO");
  });

  it("rejects malformed PNG chunks, missing card metadata, malformed base64, and wrong CCv2 versions", () => {
    const png = cardPng(card());
    png[png.length - 1] ^= 1;
    expectCode(() => extractCcv2FromPng(png), "PNG_INVALID");
    expectCode(() => extractCcv2FromPng(basePng()), "PNG_CARD_MISSING");
    expectCode(() => extractCcv2FromPng(pngWithText("chara", "not base64!")), "PNG_CARD_INVALID");
    expectCode(() => inspectArtifact(cardPng({ spec: "chara_card_v2", spec_version: "3.0", data: { name: "X" } }), "x.png"), "CCV2_INVALID");
  });

  it("imports standalone Character Card V2 JSON without embedded artwork", () => {
    const validJson = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "A kind traveler",
        tags: ["Adventurer", "Kind"],
        first_mes: "Hello adventurer!",
      },
    });
    const bytes = strToU8(validJson);
    const result = inspectArtifact(bytes, "aria.json");
    expect(result.kind).toBe("JSON");
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.status).toBe("READY");
    expect(item.character?.name).toBe("Aria");
    expect(item.character?.description).toBe("A kind traveler");
    expect(item.artworkPolicy).toBe("EMBEDDED_ARTWORK_NOT_STORED");
    expect(item.artwork).toBeUndefined();
    expect(item.message).toContain("no embedded artwork");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no embedded artwork");
  });

  it("rejects Character Card V3 JSON or unsupported spec versions", () => {
    const v3Json = JSON.stringify({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { name: "V3Bot" },
    });
    expectCode(() => inspectArtifact(strToU8(v3Json), "v3bot.json"), "CCV2_INVALID");
  });

  it("rejects PNGs exceeding the decoded total pixel limit in inspectArtifact", () => {
    const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    const ihdrData = new Uint8Array(13);
    const view = new DataView(ihdrData.buffer);
    view.setUint32(0, 5000, false);
    view.setUint32(4, 5000, false);
    ihdrData[8] = 8;
    ihdrData[9] = 6;
    const ihdrChunk = chunk("IHDR", ihdrData);
    const iendChunk = chunk("IEND", new Uint8Array(0));
    const bigPng = concat(signature, ihdrChunk, iendChunk);

    expectCode(() => inspectArtifact(bigPng, "giant.png"), "PNG_INVALID");
  });

  it("does not use an eight-character filename suffix as source identity", () => {
    const result = inspectExtractorZip(zipSync({
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 1 })),
      "001_NoIdentity_d7745ac8.png": cardPng(card()),
    }));
    expect(result.items[0].character?.platform).toBe("OTHER");
  });

  it("keeps a realistic 20-creator / 50-character mixed batch bounded and independently reviewable", () => {
    const files: Record<string, Uint8Array> = {
      "_manifest.json": strToU8(JSON.stringify({ exporter_version: "1.3.0", export_order: "oldest_to_newest", total_listed: 50 })),
    };
    for (let index = 1; index <= 47; index++) {
      const id = `d7745ac8-8b75-48ec-aaf9-${String(index).padStart(12, "0")}`;
      files[`${String(index).padStart(3, "0")}_Character_${index}_${id.slice(0, 8)}.png`] = cardPng(card({ name: `Character ${index}`, janitorId: id, creator: `Creator ${(index - 1) % 20 + 1}` }));
    }
    files["048_Duplicate_d7745ac8.png"] = cardPng(card({ name: "Duplicate", janitorId: "d7745ac8-8b75-48ec-aaf9-000000000001", creator: "Creator 1" }));
    files["049_Fallback_abcdef12.txt"] = strToU8([
      "CHARACTER CARD V2 (PARTIAL — from API metadata)",
      JSON.stringify(card({ name: "Fallback", creator: "Creator 20" })),
    ].join("\n"));
    files["050_Invalid_ffffffff.png"] = basePng();
    const result = inspectExtractorZip(zipSync(files));
    expect(result.items).toHaveLength(50);
    expect(result.items.filter((item) => item.status === "READY")).toHaveLength(47);
    expect(result.items.filter((item) => item.code === "DUPLICATE_ARTIFACT")).toHaveLength(1);
    expect(result.items.filter((item) => item.status === "FALLBACK_REVIEW_REQUIRED")).toHaveLength(1);
    expect(result.items.filter((item) => item.code === "PNG_CARD_MISSING")).toHaveLength(1);
    expect(result.manifest.crossCheck).toBe("MATCHED");
  });
});

function card({ name = "Theron", janitorId, creator = "Creator" }: { name?: string; janitorId?: string; creator?: string } = {}) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name,
      description: "Description",
      personality: "Personality",
      scenario: "Scenario",
      first_mes: "Hello",
      mes_example: "Example",
      alternate_greetings: ["Hi again"],
      tags: ["#Fantasy"],
      creator,
      extensions: { janitorai: { id: janitorId ?? null, created_at: "2025-01-01T00:00:00.000Z" } },
    },
  };
}

function cardPng(value: unknown): Uint8Array {
  return pngWithText("chara", Buffer.from(JSON.stringify(value), "utf8").toString("base64"));
}

function fallbackText(value: unknown, reference: string): string {
  return [
    "═══════════════════════════════════════════════",
    "  CHARACTER CARD V2 (PARTIAL — from API metadata)",
    "═══════════════════════════════════════════════",
    JSON.stringify(value, null, 2),
    "\n\n═══════════════════════════════════════════════",
    "  RECONSTRUCTED CARD (from generateAlpha probe)",
    "═══════════════════════════════════════════════",
    reference,
  ].join("\n");
}

function basePng(): Uint8Array {
  return png([chunk("IHDR", ihdr()), chunk("IEND", new Uint8Array())]);
}

function pngWithText(keyword: string, value: string): Uint8Array {
  return png([
    chunk("IHDR", ihdr()),
    chunk("tEXt", concat(strToU8(keyword), Uint8Array.of(0), strToU8(value))),
    chunk("IEND", new Uint8Array()),
  ]);
}

function ihdr(): Uint8Array {
  return Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0);
}

function png(chunks: Uint8Array[]): Uint8Array {
  return concat(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), ...chunks);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length, false);
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, crc32(concat(typeBytes, data)), false);
  return concat(length, typeBytes, data, checksum);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 4; offset++) if (view.getUint32(offset, true) === signature) return offset;
  throw new Error("signature missing");
}

function expectCode(run: () => unknown, code: string) {
  try { run(); throw new Error("Expected import error"); }
  catch (error) {
    expect(error).toBeInstanceOf(ArtifactImportError);
    expect(error).toMatchObject({ code });
  }
}
