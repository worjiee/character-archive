import { createHash } from "node:crypto";
import { inflateSync } from "fflate";
import type {
  NormalizedCharacter,
  NormalizedLorebook,
  NormalizedLorebookEntry,
  NormalizedTag,
} from "../types";
import { normalizeTagLabel, normalizeTagWhitespace } from "../../tags/normalization";
import { normalizeSourceProse } from "../../source-prose";
import type { ArtworkMetadata, PendingArtworkBinding } from "../../artwork/types";
import { ARTIFACT_EXPANDED_LIMIT_LABEL, ARTIFACT_LIMITS, ARTIFACT_UPLOAD_LIMIT_LABEL } from "./limits";

export {
  ARTIFACT_LIMITS,
  ARTIFACT_UPLOAD_LIMIT_LABEL,
  MAX_JSON_BYTES,
  MAX_OTHER_SUPPORTED_ENTRY_BYTES,
  MAX_PNG_BYTES,
  MAX_TXT_BYTES,
  validateArtifactUploadByteLength,
} from "./limits";

export type ArtifactErrorCode =
  | "UNSUPPORTED_FILE"
  | "ARCHIVE_TOO_LARGE"
  | "ARCHIVE_TOO_MANY_ENTRIES"
  | "ARCHIVE_ENTRY_TOO_LARGE"
  | "ARCHIVE_COMPRESSION_RATIO"
  | "ARCHIVE_ENCRYPTED"
  | "ARCHIVE_UNSAFE_PATH"
  | "ARCHIVE_DUPLICATE_PATH"
  | "ARCHIVE_INVALID"
  | "PNG_INVALID"
  | "PNG_CARD_MISSING"
  | "PNG_CARD_INVALID"
  | "CCV2_INVALID"
  | "MANIFEST_INVALID"
  | "DUPLICATE_ARTIFACT"
  | "FALLBACK_INVALID"
  | "PARTIAL_METADATA_INVALID"
  | "FALLBACK_REVIEW_REQUIRED"
  | "LOREBOOK_INVALID"
  | "LOREBOOK_AMBIGUOUS";

export class ArtifactImportError extends Error {
  readonly code: ArtifactErrorCode;
  readonly status: number;

  constructor(code: ArtifactErrorCode, message: string, status = 422) {
    super(message);
    this.name = "ArtifactImportError";
    this.code = code;
    this.status = status;
  }
}

export interface InspectedArtifactItem {
  filename: string;
  status: "READY" | "FALLBACK_REVIEW_REQUIRED" | "LOREBOOK_AMBIGUOUS" | "INVALID";
  code?: ArtifactErrorCode;
  message?: string;
  character?: NormalizedCharacter;
  fallback?: InspectedFallbackCandidate;
  artworkPolicy?: "PREPARED_UPLOADED_ARTWORK" | "UPSTREAM_METADATA_URL" | "EMBEDDED_ARTWORK_NOT_STORED";
  artwork?: InspectedArtwork;
  preparedArtwork?: PendingArtworkBinding;
}

export interface InspectedArtwork {
  metadata: ArtworkMetadata;
  readBytes: () => Uint8Array;
}

export interface InspectedFallbackCandidate {
  filename: string;
  displayName: string;
  exportIndex: number;
  filenameSuffix: string;
  source: {
    platform: NormalizedCharacter["platform"];
    externalId: string;
    sourceUrl: string;
    avatarUrl: string | null;
    sourceCreatedAt: Date | null;
    sourceUpdatedAt: Date | null;
    definitionHidden: boolean | null;
  };
  prefill: {
    name: string;
    description: string | null;
    personality: string | null;
    scenario: string | null;
    firstGreeting: string;
    alternateGreetings: string[];
    exampleDialogs: string | null;
    creatorName: string | null;
    tags: string[];
  };
  referenceSections: Array<{ title: string; content: string }>;
  lorebooks: NormalizedLorebook[];
  artifacts: {
    txt: true;
    png: boolean;
    worldInfoFiles: number;
  };
  retainedBytes: number;
  artwork?: InspectedArtwork;
  preparedArtwork?: PendingArtworkBinding;
}

export interface ArtifactInspectionResult {
  kind: "PNG" | "ZIP";
  items: InspectedArtifactItem[];
  warnings: string[];
  manifest: {
    present: boolean;
    exporterVersion: string | null;
    declaredTotal: number | null;
    crossCheck: "MATCHED" | "MISMATCH" | "NOT_APPLICABLE";
  };
}

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTRACTOR_BASENAME = /^(\d{3})_(.+)_([0-9a-f]{8})$/i;
const FALLBACK_HEADING = "CHARACTER CARD V2 (PARTIAL — from API metadata)";

export function inspectArtifact(bytes: Uint8Array, filename: string): ArtifactInspectionResult {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    const artwork = inspectPngArtwork(bytes, filename);
    const character = normalizeCcv2(extractCcv2FromPng(bytes, filename), bytes, filename);
    return {
      kind: "PNG",
      items: [{
        filename,
        status: "READY",
        character,
        artwork,
        artworkPolicy: "PREPARED_UPLOADED_ARTWORK",
      }],
      warnings: [],
      manifest: { present: false, exporterVersion: null, declaredTotal: null, crossCheck: "NOT_APPLICABLE" },
    };
  }
  if (isZip(bytes)) return inspectExtractorZip(bytes);
  throw new ArtifactImportError("UNSUPPORTED_FILE", "Upload a ZIP export or a Character Card V2 PNG.", 415);
}

export function inspectExtractorZip(bytes: Uint8Array): ArtifactInspectionResult {
  const archive = readBoundedZip(bytes);
  const warnings: string[] = [];
  const manifest = validateManifest(archive.read("_manifest.json"));
  const lorebookArchive = readLorebookFiles(archive);
  warnings.push(...lorebookArchive.warnings);
  const grouped = new Map<string, { png?: string; txt?: string; auxiliaries: string[] }>();

  for (const path of archive.entries.keys()) {
    if (path.startsWith("_lorebooks/") || path === "_manifest.json") continue;
    const lower = path.toLowerCase();
    let base: string | null = null;
    if (lower.endsWith(".png") || lower.endsWith(".txt")) base = path.slice(0, -4);
    else {
      const marker = lower.indexOf("_lorebook_worldinfo.json");
      const publicMarker = lower.indexOf("_public_lorebook_");
      if (marker > 0) base = path.slice(0, marker);
      else if (publicMarker > 0 && lower.endsWith(".json")) base = path.slice(0, publicMarker);
    }
    if (!base || !EXTRACTOR_BASENAME.test(base)) {
      warnings.push(`Ignored unrecognized archive entry: ${path}`);
      continue;
    }
    const group = grouped.get(base) ?? { auxiliaries: [] };
    if (lower.endsWith(".png")) group.png = path;
    else if (lower.endsWith(".txt")) group.txt = path;
    else group.auxiliaries.push(path);
    grouped.set(base, group);
  }

  if (grouped.size > ARTIFACT_LIMITS.characterCount) {
    throw new ArtifactImportError("ARCHIVE_TOO_MANY_ENTRIES", `An archive may contain at most ${ARTIFACT_LIMITS.characterCount} character groups.`, 413);
  }

  const items: InspectedArtifactItem[] = [];
  for (const [base, group] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    let fallbackArtwork: InspectedArtwork | undefined;
    if (group.png) {
      try {
        const png = archive.read(group.png)!;
        const metadata = inspectPngArtwork(png, group.png).metadata;
        fallbackArtwork = { metadata, readBytes: () => archive.read(group.png!)! };
        const card = extractCcv2FromPng(png, group.png);
        const character = normalizeCcv2(card, png, group.png, lorebookArchive.books, lorebookArchive.ambiguousIds);
        items.push({
          filename: group.png,
          status: "READY",
          character,
          artwork: fallbackArtwork,
          artworkPolicy: "PREPARED_UPLOADED_ARTWORK",
        });
        continue;
      } catch (error) {
        if (!(error instanceof ArtifactImportError) || error.code !== "PNG_CARD_MISSING" || !group.txt) {
          items.push(failedItem(group.png, error));
          continue;
        }
      }
    }
    if (group.txt) {
      try {
        const fallback = parseFallbackCandidate(archive.read(group.txt)!, group.txt, group, archive);
        fallback.artwork = fallbackArtwork;
        items.push({
          filename: group.txt,
          status: "FALLBACK_REVIEW_REQUIRED",
          code: "FALLBACK_REVIEW_REQUIRED",
          message: "The extractor fallback contains partial metadata and reconstructed prose that cannot be mapped without human review.",
          fallback,
          artwork: fallbackArtwork,
          artworkPolicy: fallbackArtwork ? "PREPARED_UPLOADED_ARTWORK" : "EMBEDDED_ARTWORK_NOT_STORED",
        });
      } catch (error) {
        items.push(failedItem(group.txt, error));
      }
    } else if (!group.png) {
      items.push({ filename: base, status: "INVALID", code: "ARCHIVE_INVALID", message: "Character group has no PNG or fallback TXT." });
    }
  }

  if (items.length === 0) {
    throw new ArtifactImportError("ARCHIVE_INVALID", "The ZIP contains no recognized extractor character artifacts.");
  }
  const identities = new Set<string>();
  for (const item of items) {
    if (item.status !== "READY" || !item.character) continue;
    const identity = `${item.character.platform}:${item.character.externalId}`;
    if (identities.has(identity)) {
      item.status = "INVALID";
      item.code = "DUPLICATE_ARTIFACT";
      item.message = "Another artifact in this upload has the same proven source identity.";
      delete item.character;
    } else {
      identities.add(identity);
    }
  }
  const declared = manifest.declaredTotal;
  const crossCheck = declared === null ? "NOT_APPLICABLE" : declared === items.length ? "MATCHED" : "MISMATCH";
  if (crossCheck === "MISMATCH") warnings.push(`Manifest declares ${declared} characters but ${items.length} character groups were recognized.`);
  return { kind: "ZIP", items, warnings, manifest: { ...manifest, crossCheck } };
}

interface BoundedZip {
  entries: Map<string, CentralEntry>;
  read(path: string): Uint8Array | undefined;
}

function readBoundedZip(bytes: Uint8Array): BoundedZip {
  if (bytes.byteLength > ARTIFACT_LIMITS.compressedBytes) {
    throw new ArtifactImportError("ARCHIVE_TOO_LARGE", `ZIP uploads are limited to ${ARTIFACT_UPLOAD_LIMIT_LABEL} compressed.`, 413);
  }
  const directory = parseCentralDirectory(bytes);
  const canonicalPaths = new Set<string>();
  for (const entry of directory) {
    assertSafeArchivePath(entry.path);
    if (isNestedArchivePath(entry.path)) throw new ArtifactImportError("ARCHIVE_INVALID", `Nested archives are not supported: ${entry.path}`);
    const canonical = entry.path.normalize("NFKC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonical)) throw new ArtifactImportError("ARCHIVE_DUPLICATE_PATH", `Duplicate ZIP path: ${entry.path}`);
    canonicalPaths.add(canonical);
    if (entry.encrypted) throw new ArtifactImportError("ARCHIVE_ENCRYPTED", "Encrypted ZIP entries are not supported.");
  }
  validateDeclaredArchiveBounds(directory);
  const entries = new Map<string, CentralEntry>();
  for (const entry of directory) {
    if (entry.path.endsWith("/")) continue;
    entries.set(entry.path, entry);
  }
  return { entries, read: (path) => entries.has(path) ? inflateZipEntry(bytes, entries.get(path)!) : undefined };
}

export interface ArchiveDeclaredEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted?: boolean;
}

interface CentralEntry extends ArchiveDeclaredEntry {
  compression: number;
  crc: number;
  flags: number;
  localHeaderOffset: number;
}

export function validateDeclaredArchiveBounds(directory: ReadonlyArray<ArchiveDeclaredEntry>): void {
  let expanded = 0;
  for (const entry of directory) {
    const policy = archiveEntryPolicy(entry.path);
    if (entry.uncompressedSize > policy.maxBytes) {
      throw new ArtifactImportError("ARCHIVE_ENTRY_TOO_LARGE", `${policy.label} exceeds the ${formatMiB(policy.maxBytes)} per-file limit: ${safeArchiveFilename(entry.path)}`, 413);
    }
    if (entry.uncompressedSize / Math.max(entry.compressedSize, 1) > ARTIFACT_LIMITS.compressionRatio) {
      throw new ArtifactImportError("ARCHIVE_COMPRESSION_RATIO", `Suspicious compression ratio for ZIP entry: ${entry.path}`, 413);
    }
    expanded += entry.uncompressedSize;
    if (expanded > ARTIFACT_LIMITS.expandedBytes) throw new ArtifactImportError("ARCHIVE_TOO_LARGE", `ZIP expanded data is limited to ${ARTIFACT_EXPANDED_LIMIT_LABEL}.`, 413);
  }
}

function archiveEntryPolicy(path: string): { label: string; maxBytes: number } {
  if (/\.png$/i.test(path)) return { label: "Character Card PNG", maxBytes: ARTIFACT_LIMITS.pngBytes };
  if (/\.json$/i.test(path)) return { label: "JSON entry", maxBytes: ARTIFACT_LIMITS.jsonBytes };
  if (/\.txt$/i.test(path)) return { label: "Text entry", maxBytes: ARTIFACT_LIMITS.textBytes };
  return { label: "Archive entry", maxBytes: ARTIFACT_LIMITS.otherSupportedEntryBytes };
}

function safeArchiveFilename(path: string): string {
  const filename = path.replace(/\\/g, "/").split("/").at(-1) ?? "archive entry";
  return filename.replace(/[\u0000-\u001f\u007f]/g, "�").slice(0, 240) || "archive entry";
}

function formatMiB(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`;
}

function parseCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ArtifactImportError("ARCHIVE_INVALID", "ZIP central directory is missing.");
  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ArtifactImportError("ARCHIVE_INVALID", "Multi-disk and ZIP64 archives are not supported.");
  }
  if (count > ARTIFACT_LIMITS.entryCount) throw new ArtifactImportError("ARCHIVE_TOO_MANY_ENTRIES", `ZIPs are limited to ${ARTIFACT_LIMITS.entryCount} entries.`, 413);
  if (offset + size > eocd || offset + size > bytes.byteLength) throw new ArtifactImportError("ARCHIVE_INVALID", "ZIP central directory bounds are invalid.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: CentralEntry[] = [];
  let cursor = offset;
  try {
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error();
      const flags = view.getUint16(cursor + 8, true);
      const compression = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > bytes.byteLength || localHeaderOffset === 0xffffffff || (compression !== 0 && compression !== 8)) throw new Error();
      const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      entries.push({ path, compressedSize, uncompressedSize, encrypted: (flags & 1) !== 0, compression, crc, flags, localHeaderOffset });
      cursor = end;
    }
  } catch {
    throw new ArtifactImportError("ARCHIVE_INVALID", "ZIP central directory is malformed.");
  }
  if (entries.length !== count || cursor !== offset + size) throw new ArtifactImportError("ARCHIVE_INVALID", "ZIP central directory entry count is inconsistent.");
  return entries;
}

function inflateZipEntry(bytes: Uint8Array, entry: CentralEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP local header is invalid: ${entry.path}`);
  }
  const flags = view.getUint16(offset + 6, true);
  const compression = view.getUint16(offset + 8, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (flags !== entry.flags || compression !== entry.compression || dataEnd > bytes.byteLength) {
    throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP local entry metadata is inconsistent: ${entry.path}`);
  }
  let path: string;
  try { path = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); }
  catch { throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP local path is not valid UTF-8: ${entry.path}`); }
  if (path !== entry.path) throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP local path does not match its directory entry: ${entry.path}`);

  const compressed = bytes.subarray(dataStart, dataEnd);
  let value: Uint8Array;
  try {
    if (entry.compression === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) throw new Error();
      value = compressed.slice();
    } else {
      value = inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize) });
    }
  } catch {
    throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP entry could not be decompressed safely: ${entry.path}`);
  }
  if (value.byteLength !== entry.uncompressedSize || crc32(value) !== entry.crc) {
    throw new ArtifactImportError("ARCHIVE_INVALID", `ZIP entry size or checksum mismatch: ${entry.path}`);
  }
  return value;
}

function assertSafeArchivePath(path: string): void {
  if (!path || path.length > 240 || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new ArtifactImportError("ARCHIVE_UNSAFE_PATH", `Unsafe ZIP path: ${path || "(empty)"}`);
  }
  const segments = path.split("/");
  if (segments.some((part, index) => (part === "" && index !== segments.length - 1) || part === "." || part === "..")) {
    throw new ArtifactImportError("ARCHIVE_UNSAFE_PATH", `Unsafe ZIP path: ${path}`);
  }
}

function isNestedArchivePath(path: string): boolean {
  return /\.(?:zip|zipx|7z|rar|tar|tgz|gz|bz2|xz)$/i.test(path);
}

export function inspectPngArtwork(bytes: Uint8Array, filename = "Character Card PNG"): InspectedArtwork {
  const inspected = inspectPngStructure(bytes, filename);
  const metadata: ArtworkMetadata = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "image/png",
    byteLength: bytes.byteLength,
    width: inspected.width,
    height: inspected.height,
  };
  return { metadata, readBytes: () => bytes };
}

export function extractCcv2FromPng(bytes: Uint8Array, filename = "Character Card PNG"): unknown {
  const { chara } = inspectPngStructure(bytes, filename);
  if (!chara) throw new ArtifactImportError("PNG_CARD_MISSING", "PNG has no Character Card V2 chara metadata.");
  let decoded: Uint8Array;
  try {
    const value = new TextDecoder("ascii", { fatal: true }).decode(chara);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error();
    decoded = Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    throw new ArtifactImportError("PNG_CARD_INVALID", "PNG chara metadata is not valid base64.");
  }
  if (decoded.byteLength > ARTIFACT_LIMITS.cardJsonBytes) throw new ArtifactImportError("PNG_CARD_INVALID", "Character Card metadata exceeds 2 MiB.", 413);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch {
    throw new ArtifactImportError("PNG_CARD_INVALID", "PNG chara metadata is not valid UTF-8 JSON.");
  }
}

function inspectPngStructure(bytes: Uint8Array, filename: string): { width: number; height: number; chara: Uint8Array | null } {
  assertPngByteLength(bytes.byteLength, filename);
  if (!startsWith(bytes, PNG_SIGNATURE)) throw new ArtifactImportError("PNG_INVALID", "PNG signature is invalid.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIend = false;
  let chara: Uint8Array | null = null;
  let width = 0;
  let height = 0;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new ArtifactImportError("PNG_INVALID", "PNG chunk bounds are invalid.");
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (length > ARTIFACT_LIMITS.pngBytes || end > bytes.byteLength) throw new ArtifactImportError("PNG_INVALID", "PNG chunk bounds are invalid.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const storedCrc = view.getUint32(offset + 8 + length, false);
    if (crc32(concat(typeBytes, data)) !== storedCrc) throw new ArtifactImportError("PNG_INVALID", `PNG ${type} chunk checksum is invalid.`);
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) throw new ArtifactImportError("PNG_INVALID", "PNG must begin with a valid IHDR chunk.");
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
      if (!width || !height || width > ARTIFACT_LIMITS.pngDimension || height > ARTIFACT_LIMITS.pngDimension) throw new ArtifactImportError("PNG_INVALID", "PNG dimensions are outside the supported bounds.");
      sawIhdr = true;
    }
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      const keyword = separator >= 0 ? new TextDecoder("latin1").decode(data.subarray(0, separator)) : "";
      if (keyword === "chara") {
        if (chara) throw new ArtifactImportError("PNG_CARD_INVALID", "PNG contains multiple chara metadata chunks.");
        chara = data.subarray(separator + 1);
      }
    }
    offset = end;
    if (type === "IEND") { sawIend = true; break; }
  }
  if (!sawIend || offset !== bytes.byteLength) throw new ArtifactImportError("PNG_INVALID", "PNG must end exactly after IEND.");
  return { width, height, chara };
}

export function assertPngByteLength(byteLength: number, filename = "Character Card PNG"): void {
  if (byteLength > ARTIFACT_LIMITS.pngBytes) {
    throw new ArtifactImportError("ARCHIVE_ENTRY_TOO_LARGE", `Character Card PNG exceeds the ${formatMiB(ARTIFACT_LIMITS.pngBytes)} per-file limit: ${safeArchiveFilename(filename)}`, 413);
  }
}

export function normalizeCcv2(
  value: unknown,
  identityBytes: Uint8Array,
  filename: string,
  archiveLorebooks: Map<string, NormalizedLorebook> = new Map(),
  ambiguousLorebookIds: Set<string> = new Set(),
): NormalizedCharacter {
  const root = record(value, "Character Card V2 root");
  if (root.spec !== "chara_card_v2" || root.spec_version !== "2.0") throw new ArtifactImportError("CCV2_INVALID", "Only chara_card_v2 spec version 2.0 is supported.");
  const data = record(root.data, "Character Card V2 data");
  const name = requiredString(data.name, "name", 300);
  const extensions = optionalRecord(data.extensions);
  const janitor = optionalRecord(extensions?.janitorai);
  const janitorId = typeof janitor?.id === "string" && UUID.test(janitor.id.trim()) ? janitor.id.trim().toLowerCase() : null;
  // Source-neutral identity follows the validated card contract, not the
  // container filename or replaceable artwork bytes.
  void identityBytes;
  const digest = createHash("sha256").update(JSON.stringify(root), "utf8").digest("hex");
  const platform = janitorId ? "JANITOR_AI" as const : "OTHER" as const;
  const externalId = janitorId ?? `ccv2-${digest}`;
  const sourceUrl = janitorId
    ? `https://janitorai.com/characters/${janitorId}`
    : `urn:character-card:sha256:${digest}`;
  const tags = normalizeCardTags(data.tags);
  const greetings = normalizeCardGreetings(data.first_mes, data.alternate_greetings);
  const embeddedLorebooks = normalizeCardLorebooks(data.character_book, platform, sourceUrl, externalId, archiveLorebooks, ambiguousLorebookIds);
  const lorebookReferences = embeddedLorebooks.map(({ externalId: id, title }) => ({ externalId: id, title }));
  for (const reference of readJanitorLorebookReferences(janitor?.lorebooks)) {
    if (!lorebookReferences.some((item) => item.externalId === reference.externalId)) lorebookReferences.push(reference);
  }
  const avatarFile = typeof janitor?.avatar_file === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,240}$/.test(janitor.avatar_file)
    ? janitor.avatar_file
    : null;

  return {
    externalId,
    platform,
    sourceUrl,
    name,
    description: normalizeSourceProse(optionalString(data.description, "description")),
    personality: normalizeSourceProse(optionalString(data.personality, "personality")),
    scenario: normalizeSourceProse(optionalString(data.scenario, "scenario")),
    exampleDialogs: normalizeSourceProse(optionalString(data.mes_example, "mes_example")),
    avatarUrl: janitorId && avatarFile ? `https://ella.janitorai.com/bot-avatars/${encodeURIComponent(avatarFile)}` : null,
    creator: { externalId: null, name: optionalString(data.creator, "creator", 300) },
    greetings,
    tags,
    lorebookReferences,
    ...(embeddedLorebooks.length > 0 ? { embeddedLorebooks } : {}),
    sourceCreatedAt: optionalDate(janitor?.created_at),
    sourceUpdatedAt: optionalDate(janitor?.updated_at),
    rawData: { spec: root.spec, spec_version: root.spec_version, data, importFilename: filename },
  };
}

function normalizeCardTags(value: unknown): NormalizedTag[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) throw new ArtifactImportError("CCV2_INVALID", "CCv2 tags must be a bounded string array.");
  const seen = new Set<string>();
  const tags: NormalizedTag[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > 200) throw new ArtifactImportError("CCV2_INVALID", "CCv2 tags must contain bounded strings.");
    const name = normalizeTagWhitespace(item);
    const identity = normalizeTagLabel(name);
    if (!name || !identity || seen.has(identity)) continue;
    seen.add(identity);
    tags.push({ name, slug: slugify(identity) });
  }
  return tags;
}

function normalizeCardGreetings(first: unknown, alternates: unknown): Array<{ content: string; position: number }> {
  if (alternates !== undefined && alternates !== null && (!Array.isArray(alternates) || alternates.length > 100)) throw new ArtifactImportError("CCV2_INVALID", "CCv2 alternate_greetings must be a bounded string array.");
  const values = [first, ...(Array.isArray(alternates) ? alternates : [])];
  const seen = new Set<string>();
  const result: Array<{ content: string; position: number }> = [];
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") throw new ArtifactImportError("CCV2_INVALID", "CCv2 greetings must be strings.");
    const content = normalizeSourceProse(value);
    if (!content || seen.has(content)) continue;
    seen.add(content);
    result.push({ content, position: result.length });
  }
  return result;
}

function normalizeCardLorebooks(
  value: unknown,
  platform: NormalizedCharacter["platform"],
  characterSourceUrl: string,
  characterExternalId: string,
  archiveLorebooks: Map<string, NormalizedLorebook>,
  ambiguousLorebookIds: Set<string>,
): NormalizedLorebook[] {
  if (value === undefined || value === null) return [];
  const book = record(value, "CCv2 character_book");
  const entries = Array.isArray(book.entries) ? book.entries : null;
  if (!entries || entries.length > ARTIFACT_LIMITS.lorebookEntries) throw new ArtifactImportError("CCV2_INVALID", "CCv2 character_book entries are invalid or too numerous.");
  const metadata = optionalRecord(optionalRecord(book.extensions)?.janitorai);
  const declared = Array.isArray(metadata?.lorebooks) ? metadata!.lorebooks : [];
  const byLorebookId = new Map<string, unknown[]>();
  for (const entry of entries) {
    const sourceId = optionalRecord(optionalRecord(optionalRecord(entry)?.extensions)?.janitorai)?.lorebook_id;
    const id = typeof sourceId === "string" && sourceId.trim() ? sourceId.trim() : null;
    if (declared.length > 1 && !id) throw new ArtifactImportError("LOREBOOK_AMBIGUOUS", "CCv2 combines multiple lorebooks but an entry has no source lorebook ID.");
    const key = id ?? (declared.length === 1 && isRecord(declared[0]) && typeof declared[0].id === "string" ? declared[0].id : `card-book-${characterExternalId}`);
    byLorebookId.set(key, [...(byLorebookId.get(key) ?? []), entry]);
  }
  const output: NormalizedLorebook[] = [];
  for (const [id, rawEntries] of byLorebookId) {
    if (ambiguousLorebookIds.has(id)) throw new ArtifactImportError("LOREBOOK_AMBIGUOUS", `Multiple archive lorebook files claim ID ${id}.`);
    const archived = archiveLorebooks.get(id);
    if (archived) {
      if (archived.platform !== platform) {
        throw new ArtifactImportError(
          "LOREBOOK_AMBIGUOUS",
          `Archive lorebook ${id} does not match the Character source platform.`,
        );
      }
      output.push(archived);
      continue;
    }
    const declaredBook = declared.find((item) => isRecord(item) && item.id === id);
    const meta = optionalRecord(declaredBook);
    output.push({
      externalId: id,
      platform,
      title: typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim() : optionalString(book.name, "character_book.name", 300) ?? "Character lorebook",
      description: typeof meta?.description === "string" ? meta.description : optionalString(book.description, "character_book.description"),
      sourceUrl: `${characterSourceUrl.split("#", 1)[0]}#lorebook-${encodeURIComponent(id)}`,
      entries: rawEntries.map((entry, index) => normalizeLorebookEntry(entry, index)),
      rawData: { name: book.name ?? null, entries: rawEntries },
    });
  }
  return output;
}

function normalizeLorebookEntry(value: unknown, index: number): NormalizedLorebookEntry {
  const entry = record(value, `lorebook entry ${index}`);
  const janitor = optionalRecord(optionalRecord(entry.extensions)?.janitorai);
  const sourceId = janitor?.source_id ?? entry.id ?? index;
  const keysValue = entry.keys ?? entry.key;
  const keys = Array.isArray(keysValue) ? keysValue.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : typeof keysValue === "string" ? [keysValue.trim()].filter(Boolean) : [];
  return {
    externalEntryId: String(sourceId),
    content: requiredString(entry.content, `lorebook entry ${index} content`, 1_000_000, false),
    keys,
    category: typeof janitor?.category === "string" ? janitor.category : null,
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    constant: typeof entry.constant === "boolean" ? entry.constant : false,
    insertionOrder: Number.isSafeInteger(entry.insertion_order) ? entry.insertion_order as number : index,
    comment: typeof entry.comment === "string" ? entry.comment : typeof entry.name === "string" ? entry.name : null,
    caseSensitive: typeof entry.case_sensitive === "boolean" ? entry.case_sensitive : null,
    activationMode: typeof janitor?.activationMode === "string" ? janitor.activationMode : null,
    activationScript: typeof janitor?.activationScript === "string" ? janitor.activationScript : null,
    groupWeight: Number.isSafeInteger(janitor?.groupWeight) ? janitor!.groupWeight as number : null,
    rawData: entry,
  };
}

function readLorebookFiles(archive: BoundedZip): {
  books: Map<string, NormalizedLorebook>;
  ambiguousIds: Set<string>;
  warnings: string[];
} {
  const books = new Map<string, NormalizedLorebook>();
  const ambiguousIds = new Set<string>();
  const warnings: string[] = [];
  for (const path of archive.entries.keys()) {
    if (!path.startsWith("_lorebooks/") || path === "_lorebooks/_index.json" || !path.endsWith(".json")) continue;
    try {
      const bytes = archive.read(path)!;
      const source = parseBoundedJson(bytes, ARTIFACT_LIMITS.jsonBytes, path);
      const value = record(source, path);
      const id = requiredString(value.id, `${path} id`, 300);
      const rawEntries = Array.isArray(value.entries) ? value.entries : null;
      if (!rawEntries || rawEntries.length > ARTIFACT_LIMITS.lorebookEntries) throw new Error();
      const normalized: NormalizedLorebook = {
        externalId: id,
        platform: value.source === "janitorai" ? "JANITOR_AI" : "OTHER",
        title: requiredString(value.title, `${path} title`, 300),
        description: optionalString(value.description, `${path} description`),
        sourceUrl: `urn:extractor-lorebook:${encodeURIComponent(id)}`,
        entries: rawEntries.map((entry, index) => normalizeLorebookEntry(entry, index)),
        rawData: value,
      };
      if (books.has(id)) ambiguousIds.add(id);
      else books.set(id, normalized);
    } catch {
      warnings.push(`Ignored invalid lorebook file: ${path}`);
    }
  }
  return { books, ambiguousIds, warnings };
}

function readJanitorLorebookReferences(value: unknown): Array<{ externalId: string; title: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    return [{ externalId: item.id.trim(), title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled lorebook" }];
  });
}

function parseFallbackCandidate(
  bytes: Uint8Array,
  filename: string,
  group: { png?: string; txt?: string; auxiliaries: string[] },
  archive: BoundedZip,
): InspectedFallbackCandidate {
  if (bytes.byteLength > ARTIFACT_LIMITS.textBytes) throw new ArtifactImportError("ARCHIVE_ENTRY_TOO_LARGE", "Fallback TXT exceeds 2 MiB.", 413);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n"); }
  catch { throw new ArtifactImportError("FALLBACK_INVALID", "Fallback TXT is not valid UTF-8."); }
  const heading = text.indexOf(FALLBACK_HEADING);
  if (heading < 0) throw new ArtifactImportError("FALLBACK_INVALID", "Fallback TXT does not match the extractor section contract.");
  const jsonStart = text.indexOf("{", heading + FALLBACK_HEADING.length);
  if (jsonStart < 0) throw new ArtifactImportError("PARTIAL_METADATA_INVALID", "Fallback TXT has no partial CCv2 JSON.");
  const jsonEnd = findBalancedJsonEnd(text, jsonStart);
  if (jsonEnd < 0) throw new ArtifactImportError("PARTIAL_METADATA_INVALID", "Fallback TXT partial CCv2 JSON is truncated.");
  let root: unknown;
  try { root = JSON.parse(text.slice(jsonStart, jsonEnd)); }
  catch { throw new ArtifactImportError("PARTIAL_METADATA_INVALID", "Fallback TXT partial CCv2 JSON is malformed."); }
  const recordRoot = record(root, "fallback CCv2");
  if (recordRoot.spec !== "chara_card_v2" || recordRoot.spec_version !== "2.0") throw new ArtifactImportError("PARTIAL_METADATA_INVALID", "Fallback TXT contains an unsupported partial card contract.");
  const data = record(recordRoot.data, "fallback CCv2 data");
  const extensions = optionalRecord(data.extensions);
  const janitor = optionalRecord(extensions?.janitorai);
  if (janitor?.showdefinition !== undefined && janitor.showdefinition !== null && typeof janitor.showdefinition !== "boolean") {
    throw new ArtifactImportError("PARTIAL_METADATA_INVALID", "Fallback definition visibility must be boolean when present.");
  }

  let normalized: NormalizedCharacter;
  try { normalized = normalizeCcv2(root, bytes, filename); }
  catch (error) {
    if (error instanceof ArtifactImportError) throw new ArtifactImportError("PARTIAL_METADATA_INVALID", error.message, error.status);
    throw error;
  }
  const base = filename.slice(0, -4);
  const match = EXTRACTOR_BASENAME.exec(base);
  if (!match) throw new ArtifactImportError("FALLBACK_INVALID", "Fallback filename does not match the extractor group contract.");
  const filenameSuffix = match[3].toLowerCase();
  if (normalized.platform === "JANITOR_AI" && !normalized.externalId.toLowerCase().startsWith(filenameSuffix)) {
    throw new ArtifactImportError("FALLBACK_INVALID", "Fallback source identity does not match its extractor group.");
  }

  const lorebookPaths = group.auxiliaries.filter((path) => /_(?:lorebook_worldinfo|public_lorebook_.+)\.json$/i.test(path));
  const lorebooks = lorebookPaths.map((path) => {
    try { return normalizeWorldInfoArtifact(archive.read(path)!, path, normalized); }
    catch (error) {
      if (error instanceof ArtifactImportError && error.code === "ARCHIVE_ENTRY_TOO_LARGE") throw error;
      throw new ArtifactImportError("LOREBOOK_INVALID", `Associated World Info is invalid: ${safeArchiveFilename(path)}`);
    }
  });
  const referenceSections = readFallbackReferenceSections(text, jsonEnd);
  const firstGreeting = normalized.greetings[0]?.content ?? "";

  return {
    filename,
    displayName: normalized.name,
    exportIndex: Number.parseInt(match[1], 10),
    filenameSuffix,
    source: {
      platform: normalized.platform,
      externalId: normalized.externalId,
      sourceUrl: normalized.sourceUrl,
      avatarUrl: normalized.avatarUrl,
      sourceCreatedAt: normalized.sourceCreatedAt,
      sourceUpdatedAt: normalized.sourceUpdatedAt,
      definitionHidden: typeof janitor?.showdefinition === "boolean" ? janitor.showdefinition === false : null,
    },
    prefill: {
      name: normalized.name,
      description: normalized.description,
      personality: normalized.personality,
      scenario: normalized.scenario,
      firstGreeting,
      alternateGreetings: normalized.greetings.slice(1).map(({ content }) => content),
      exampleDialogs: normalized.exampleDialogs,
      creatorName: normalized.creator.name,
      tags: normalized.tags.map(({ name }) => name),
    },
    referenceSections,
    lorebooks,
    artifacts: { txt: true, png: Boolean(group.png), worldInfoFiles: lorebookPaths.length },
    retainedBytes: Buffer.byteLength(JSON.stringify({ referenceSections, lorebooks }), "utf8"),
  };
}

function readFallbackReferenceSections(text: string, jsonEnd: number): Array<{ title: string; content: string }> {
  const delimiter = /^═{20,}\n  ([^\n]{1,160})\n═{20,}\n/gm;
  const matches = [...text.matchAll(delimiter)];
  const sections: Array<{ title: string; content: string }> = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const title = match[1].trim();
    if (title === FALLBACK_HEADING || (match.index ?? 0) < jsonEnd) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    if (content) sections.push({ title, content });
  }
  return sections;
}

function normalizeWorldInfoArtifact(bytes: Uint8Array, filename: string, character: NormalizedCharacter): NormalizedLorebook {
  const value = parseBoundedJson(bytes, ARTIFACT_LIMITS.jsonBytes, filename);
  const root = record(value, `${filename} World Info`);
  const entriesRecord = optionalRecord(root.entries);
  if (!entriesRecord) throw new ArtifactImportError("LOREBOOK_INVALID", "Associated World Info must contain an entries object.");
  const rows = Object.entries(entriesRecord);
  if (rows.length > ARTIFACT_LIMITS.lorebookEntries) throw new ArtifactImportError("LOREBOOK_INVALID", "Associated World Info contains too many entries.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const titleMatch = /_public_lorebook_(.+)\.json$/i.exec(filename);
  const title = titleMatch ? titleMatch[1].replaceAll("_", " ").trim() || "Public lorebook" : `${character.name} lorebook`;
  const entries = rows
    .sort(([left], [right]) => Number(left) - Number(right) || left.localeCompare(right))
    .map(([id, raw], index): NormalizedLorebookEntry => {
      const entry = record(raw, `${filename} entry ${id}`);
      const content = requiredString(entry.content, `${filename} entry ${id} content`, 1_000_000, false);
      const keys = normalizeWorldInfoKeys(entry.key ?? entry.keys, filename, id);
      const secondary = normalizeWorldInfoKeys(entry.keysecondary, filename, id);
      return {
        externalEntryId: id,
        content,
        keys: [...new Set([...keys, ...secondary])],
        category: null,
        enabled: entry.disable !== true,
        constant: entry.constant === true,
        insertionOrder: Number.isSafeInteger(entry.order) ? entry.order as number : index,
        comment: typeof entry.comment === "string" && entry.comment.length <= 10_000 ? entry.comment : null,
        caseSensitive: typeof entry.caseSensitive === "boolean" ? entry.caseSensitive : null,
        activationMode: null,
        activationScript: null,
        groupWeight: Number.isSafeInteger(entry.groupWeight) ? entry.groupWeight as number : null,
        rawData: { format: "sillytavern-world-info", sourceEntryId: id },
      };
    });
  return {
    externalId: `artifact-worldinfo-${digest}`,
    platform: character.platform,
    title,
    description: "World Info supplied with the extractor fallback artifact.",
    sourceUrl: `${character.sourceUrl.split("#", 1)[0]}#artifact-worldinfo-${digest}`,
    entries,
    rawData: { format: "sillytavern-world-info", importFilename: filename },
  };
}

function normalizeWorldInfoKeys(value: unknown, filename: string, id: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const keys = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!keys || keys.length > 500 || keys.some((key) => typeof key !== "string" || key.length > 500)) {
    throw new ArtifactImportError("LOREBOOK_INVALID", `${filename} entry ${id} has invalid trigger keys.`);
  }
  return keys.map((key) => String(key).trim()).filter(Boolean);
}

function validateManifest(bytes: Uint8Array | undefined): { present: boolean; exporterVersion: string | null; declaredTotal: number | null } {
  if (!bytes) return { present: false, exporterVersion: null, declaredTotal: null };
  const value = parseBoundedJson(bytes, 256 * 1024, "_manifest.json");
  if (!isRecord(value)) throw new ArtifactImportError("MANIFEST_INVALID", "Extractor manifest must be an object.");
  const exporterVersion = typeof value.exporter_version === "string" && value.exporter_version.length <= 100 ? value.exporter_version : null;
  const declaredTotal = Number.isSafeInteger(value.total_listed) && (value.total_listed as number) >= 0 && (value.total_listed as number) <= ARTIFACT_LIMITS.characterCount ? value.total_listed as number : null;
  if (!exporterVersion || declaredTotal === null || value.export_order !== "oldest_to_newest") throw new ArtifactImportError("MANIFEST_INVALID", "Extractor manifest fields are invalid.");
  return { present: true, exporterVersion, declaredTotal };
}

function parseBoundedJson(bytes: Uint8Array, max: number, label: string): unknown {
  if (bytes.byteLength > max) throw new ArtifactImportError("ARCHIVE_ENTRY_TOO_LARGE", `${label} exceeds its size limit.`, 413);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ArtifactImportError("ARCHIVE_INVALID", `${label} is not valid UTF-8 JSON.`); }
}

function failedItem(filename: string, error: unknown): InspectedArtifactItem {
  if (error instanceof ArtifactImportError) {
    const status = error.code === "LOREBOOK_AMBIGUOUS" ? "LOREBOOK_AMBIGUOUS" : "INVALID";
    return { filename, status, code: error.code, message: error.message };
  }
  return { filename, status: "INVALID", code: "ARCHIVE_INVALID", message: "Artifact could not be inspected safely." };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ArtifactImportError("CCV2_INVALID", `${label} must be an object.`);
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function requiredString(value: unknown, field: string, max: number, trim = true): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ArtifactImportError("CCV2_INVALID", `CCv2 ${field} must be a non-empty bounded string.`);
  return trim ? value.trim() : value;
}

function optionalString(value: unknown, field: string, max = 1_000_000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new ArtifactImportError("CCV2_INVALID", `CCv2 ${field} must be a bounded string when present.`);
  return value;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}

function slugify(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function findBalancedJsonEnd(text: string, start: number): number {
  let depth = 0, string = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (string) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const output = new Uint8Array(a.length + b.length); output.set(a); output.set(b, a.length); return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
