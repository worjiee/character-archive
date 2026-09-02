export const TAG_SEARCH_QUERY_MAX_LENGTH = 100;

/**
 * Produces the shared matching and alphabetical key for tag labels.
 *
 * The source spelling is never stored through this function. It deliberately
 * removes only one optional leading hash, while retaining all other
 * punctuation so unrelated labels do not collapse into the same identity.
 */
export function normalizeTagLabel(value: string): string {
  return normalizeTagWhitespace(value)
    .replace(/^#\s*/u, "")
    .toLocaleLowerCase("en-US");
}

/** Cleans transport whitespace without changing meaningful source spelling. */
export function normalizeTagWhitespace(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

/**
 * Chooses a stable canonical name for a newly discovered tag. Existing
 * canonical names always win during resolution.
 */
export function canonicalNameForSourceTag(rawLabel: string): string {
  const displayLabel = normalizeTagWhitespace(rawLabel);
  const withoutHash = displayLabel.replace(/^#\s*/u, "");
  return withoutHash || displayLabel;
}

export function alphabeticalTagGroup(normalizedLabel: string): string {
  const first = Array.from(normalizedLabel)[0];
  return first && /^[a-z]$/u.test(first) ? first.toUpperCase() : "#";
}
