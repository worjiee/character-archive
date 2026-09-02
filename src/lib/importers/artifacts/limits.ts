export const MIB = 1024 * 1024;

export const MAX_PNG_BYTES = 32 * MIB;
export const MAX_JSON_BYTES = 2 * MIB;
export const MAX_TXT_BYTES = 2 * MIB;
export const MAX_OTHER_SUPPORTED_ENTRY_BYTES = 2 * MIB;

export const ARTIFACT_LIMITS = Object.freeze({
  compressedBytes: 256 * MIB,
  expandedBytes: 1024 * MIB,
  pngBytes: MAX_PNG_BYTES,
  jsonBytes: MAX_JSON_BYTES,
  textBytes: MAX_TXT_BYTES,
  otherSupportedEntryBytes: MAX_OTHER_SUPPORTED_ENTRY_BYTES,
  entryCount: 1_000,
  characterCount: 250,
  compressionRatio: 200,
  cardJsonBytes: 2 * MIB,
  lorebookEntries: 5_000,
  pngDimension: 16_384,
});

export const ARTIFACT_UPLOAD_LIMIT_LABEL = "256 MiB";
export const ARTIFACT_EXPANDED_LIMIT_LABEL = "1 GiB";

export function validateArtifactUploadByteLength(size: number): string | null {
  if (!Number.isSafeInteger(size) || size <= 0) return "Choose a non-empty ZIP export or Character Card PNG.";
  if (size > ARTIFACT_LIMITS.compressedBytes) {
    return `This archive is larger than the ${ARTIFACT_UPLOAD_LIMIT_LABEL} upload limit.`;
  }
  return null;
}
