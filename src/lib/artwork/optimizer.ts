import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { ARTIFACT_LIMITS } from "../importers/artifacts/limits";
import type { ArtworkMetadata } from "./types";

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export class ArtworkPreparationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "ArtworkPreparationError";
    this.code = code;
    this.status = status;
  }
}

export interface PreparedCanonicalArtwork {
  bytes: Uint8Array;
  metadata: ArtworkMetadata;
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function stripPngPromptMetadata(bytes: Uint8Array): {
  strippedBytes: Uint8Array;
  width: number;
  height: number;
  strippedCount: number;
} {
  if (!startsWith(bytes, PNG_SIGNATURE)) {
    throw new ArtworkPreparationError("PNG_INVALID", "PNG signature is invalid.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIend = false;
  let width = 0;
  let height = 0;
  let strippedCount = 0;
  const keptParts: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      throw new ArtworkPreparationError("PNG_INVALID", "PNG chunk bounds are invalid.");
    }
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) {
      throw new ArtworkPreparationError("PNG_INVALID", "PNG chunk bounds are invalid.");
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const storedCrc = view.getUint32(offset + 8 + length, false);
    if (crc32(concat(typeBytes, data)) !== storedCrc) {
      throw new ArtworkPreparationError("PNG_INVALID", `PNG ${type} chunk checksum is invalid.`);
    }

    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) {
        throw new ArtworkPreparationError("PNG_INVALID", "PNG must begin with a valid IHDR chunk.");
      }
      const ihdrView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = ihdrView.getUint32(0, false);
      height = ihdrView.getUint32(4, false);
      if (!width || !height || width > ARTIFACT_LIMITS.pngDimension || height > ARTIFACT_LIMITS.pngDimension) {
        throw new ArtworkPreparationError("PNG_INVALID", "PNG dimensions are outside the supported bounds.");
      }
      const totalPixels = width * height;
      if (totalPixels > ARTIFACT_LIMITS.pngMaxPixels) {
        const mp = (totalPixels / 1_000_000).toFixed(1);
        const limitMp = Math.round(ARTIFACT_LIMITS.pngMaxPixels / 1_000_000);
        throw new ArtworkPreparationError(
          "PNG_INVALID",
          `PNG resolution (${width}x${height} = ${mp} MP) exceeds the ${limitMp} megapixel limit.`,
        );
      }
      sawIhdr = true;
    }

    let shouldStrip = false;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const sep = data.indexOf(0);
      const keyword = sep >= 0 ? new TextDecoder("latin1").decode(data.subarray(0, sep)) : "";
      if (keyword === "chara" || keyword === "ccv3" || keyword === "Description") {
        shouldStrip = true;
        strippedCount += 1;
      }
    }

    if (!shouldStrip) {
      keptParts.push(bytes.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }

  if (!sawIend || offset !== bytes.byteLength) {
    throw new ArtworkPreparationError("PNG_INVALID", "PNG must end exactly after IEND.");
  }

  return {
    strippedBytes: concat(...keptParts),
    width,
    height,
    strippedCount,
  };
}

export async function prepareCanonicalLosslessArtwork(
  rawPngBytes: Uint8Array,
): Promise<PreparedCanonicalArtwork> {
  const { strippedBytes } = stripPngPromptMetadata(rawPngBytes);

  let origDecoded: PNG;
  try {
    origDecoded = PNG.sync.read(Buffer.from(rawPngBytes));
  } catch {
    throw new ArtworkPreparationError("PNG_INVALID", "Failed to decode PNG image data.");
  }

  let optimizedBytes: Uint8Array;
  try {
    const oxipngModule = await import("@wasm-codecs/oxipng");
    const encode = (oxipngModule as unknown as { default: (data: Buffer, options: { level: number }) => Promise<Uint8Array> }).default || oxipngModule;
    const encoded = await encode(Buffer.from(strippedBytes), { level: 2 });
    optimizedBytes = new Uint8Array(encoded);
  } catch {
    // If oxipng optimization fails, fall back to stripped bytes
    optimizedBytes = strippedBytes;
  }

  let optDecoded: PNG;
  try {
    optDecoded = PNG.sync.read(Buffer.from(optimizedBytes));
  } catch {
    throw new ArtworkPreparationError("PNG_INVALID", "Failed to decode optimized PNG image data.");
  }

  if (
    origDecoded.width !== optDecoded.width ||
    origDecoded.height !== optDecoded.height ||
    !origDecoded.data.equals(optDecoded.data)
  ) {
    throw new ArtworkPreparationError(
      "PNG_INVALID",
      "Prepared artwork failed decoded pixel equivalence verification.",
    );
  }

  if (Buffer.from(optimizedBytes).includes("chara")) {
    throw new ArtworkPreparationError(
      "PNG_INVALID",
      "Prepared artwork still contains character prompt metadata.",
    );
  }

  const sha256 = createHash("sha256").update(optimizedBytes).digest("hex");
  const metadata: ArtworkMetadata = {
    sha256,
    mediaType: "image/png",
    byteLength: optimizedBytes.byteLength,
    width: optDecoded.width,
    height: optDecoded.height,
  };

  return {
    bytes: optimizedBytes,
    metadata,
  };
}
