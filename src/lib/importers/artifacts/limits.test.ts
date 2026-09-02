import { describe, expect, it } from "vitest";
import {
  ARTIFACT_LIMITS,
  MAX_JSON_BYTES,
  MAX_OTHER_SUPPORTED_ENTRY_BYTES,
  MAX_PNG_BYTES,
  MAX_TXT_BYTES,
  MIB,
  validateArtifactUploadByteLength,
} from "./limits";

describe("artifact upload byte limits", () => {
  it.each([
    [64 * MIB, true],
    [256 * MIB - 1, true],
    [256 * MIB, true],
    [256 * MIB + 1, false],
  ])("validates %i bytes without allocating a physical fixture", (size, accepted) => {
    expect(validateArtifactUploadByteLength(size) === null).toBe(accepted);
  });

  it("keeps compressed, expanded, and type-specific ceilings explicit", () => {
    expect(ARTIFACT_LIMITS).toMatchObject({
      compressedBytes: 268_435_456,
      expandedBytes: 1_073_741_824,
      pngBytes: 33_554_432,
      jsonBytes: 2_097_152,
      textBytes: 2_097_152,
      otherSupportedEntryBytes: 2_097_152,
    });
    expect([MAX_PNG_BYTES, MAX_JSON_BYTES, MAX_TXT_BYTES, MAX_OTHER_SUPPORTED_ENTRY_BYTES])
      .toEqual([32 * MIB, 2 * MIB, 2 * MIB, 2 * MIB]);
  });
});
