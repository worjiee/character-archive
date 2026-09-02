export const STRICT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeStrictUuid(value: string | undefined): string | null {
  if (!value || !STRICT_UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function normalizeUuidPrefix(value: string | undefined): string | null {
  return normalizeStrictUuid(value?.split("_", 1)[0]);
}
