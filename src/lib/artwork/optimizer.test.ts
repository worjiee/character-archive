import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  ArtworkPreparationError,
  prepareCanonicalLosslessArtwork,
  stripPngPromptMetadata,
} from "./optimizer";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Buffer.from(type, "ascii");
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length, false);
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, crc32(concat(typeBytes, data)), false);
  return concat(length, typeBytes, data, checksum);
}

function makeValidPng(width = 4, height = 4): Uint8Array {
  const p = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    p.data[i] = (i * 17) % 256;
    p.data[i + 1] = (i * 31) % 256;
    p.data[i + 2] = (i * 73) % 256;
    p.data[i + 3] = 255;
  }
  return new Uint8Array(PNG.sync.write(p));
}

function injectTextChunk(pngBytes: Uint8Array, keyword: string, text: string): Uint8Array {
  const iendIndex = Buffer.from(pngBytes).indexOf(Buffer.from("IEND"));
  const beforeIend = pngBytes.subarray(0, iendIndex - 4);
  const iend = pngBytes.subarray(iendIndex - 4);

  const textData = concat(Buffer.from(`${keyword}\0`, "latin1"), Buffer.from(text, "latin1"));
  const textChunk = chunk("tEXt", textData);
  return concat(beforeIend, textChunk, iend);
}

describe("optimizer & prompt metadata stripper", () => {
  it("strips tEXt chara chunk while preserving image pixels", () => {
    const valid = makeValidPng(4, 4);
    const cardData = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "TestBot" } });
    const pngWithChara = injectTextChunk(valid, "chara", Buffer.from(cardData).toString("base64"));

    expect(Buffer.from(pngWithChara).includes("chara")).toBe(true);

    const { strippedBytes, strippedCount } = stripPngPromptMetadata(pngWithChara);
    expect(strippedCount).toBe(1);
    expect(Buffer.from(strippedBytes).includes("chara")).toBe(false);

    const origDecoded = PNG.sync.read(Buffer.from(pngWithChara));
    const strippedDecoded = PNG.sync.read(Buffer.from(strippedBytes));
    expect(origDecoded.width).toBe(strippedDecoded.width);
    expect(origDecoded.height).toBe(strippedDecoded.height);
    expect(origDecoded.data.equals(strippedDecoded.data)).toBe(true);
  });

  it("prepares canonical lossless artwork without metadata and with verified decoded pixel equivalence", async () => {
    const valid = makeValidPng(8, 8);
    const pngWithChara = injectTextChunk(valid, "chara", Buffer.from("super-secret-prompt-content").toString("base64"));

    const prepared = await prepareCanonicalLosslessArtwork(pngWithChara);

    expect(prepared.bytes.byteLength).toBeGreaterThan(0);
    expect(prepared.metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.metadata.mediaType).toBe("image/png");
    expect(prepared.metadata.width).toBe(8);
    expect(prepared.metadata.height).toBe(8);

    // Verify chara chunk is completely stripped from output
    expect(Buffer.from(prepared.bytes).includes("chara")).toBe(false);

    // Verify exact pixel equivalence
    const origDecoded = PNG.sync.read(Buffer.from(pngWithChara));
    const optDecoded = PNG.sync.read(Buffer.from(prepared.bytes));
    expect(origDecoded.data.equals(optDecoded.data)).toBe(true);
  });

  it("fails if magic bytes are invalid", () => {
    const invalid = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => stripPngPromptMetadata(invalid)).toThrow(ArtworkPreparationError);
    expect(() => stripPngPromptMetadata(invalid)).toThrowError(expect.objectContaining({ code: "PNG_INVALID" }));
  });

  it("fails if chunk checksum is corrupt", () => {
    const valid = makeValidPng(2, 2);
    // Corrupt a byte in the IHDR chunk
    const corrupted = valid.slice();
    corrupted[16] ^= 0xff;
    expect(() => stripPngPromptMetadata(corrupted)).toThrow(ArtworkPreparationError);
  });

  it("rejects images exceeding the decoded total pixel limit", () => {
    // Construct a minimal synthetic PNG header declaring 5000x5000 = 25 MP (> 16 MP limit)
    const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
    const ihdrData = new Uint8Array(13);
    const view = new DataView(ihdrData.buffer);
    view.setUint32(0, 5000, false); // width
    view.setUint32(4, 5000, false); // height
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // color type RGBA

    const ihdrChunk = chunk("IHDR", ihdrData);
    const iendChunk = chunk("IEND", new Uint8Array(0));
    const bigPng = concat(signature, ihdrChunk, iendChunk);

    expect(() => stripPngPromptMetadata(bigPng)).toThrow(ArtworkPreparationError);
    expect(() => stripPngPromptMetadata(bigPng)).toThrow("exceeds the 17 megapixel limit");
  });
});
