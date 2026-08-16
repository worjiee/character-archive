export type ModerationRuleType =
  | "CHARACTER_NAME"
  | "CREATOR_NAME"
  | "CREATOR_ID"
  | "TAG"
  | "KEYWORD";

export type ModerationPlatform = "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";

export interface ModerationRule {
  id: string;
  type: ModerationRuleType;
  value: string;
  enabled: boolean;
}

export interface ModerationBlockedCreator {
  id: string;
  platform: ModerationPlatform | null;
  externalCreatorId: string | null;
  creatorName: string | null;
  enabled: boolean;
}

export interface FilterableCharacter {
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  exampleDialogs: string | null;
  greetings: string[];
  tags: Array<{ name: string; slug: string }>;
  sources: Array<{
    platform: ModerationPlatform;
    externalCreatorId: string | null;
    creatorName: string | null;
  }>;
}

export interface ModerationMatch {
  ruleId: string;
  type: ModerationRuleType;
  value: string;
  matchedField: string;
  matchedValue: string;
}

export interface ModerationResult {
  blocked: boolean;
  matches: ModerationMatch[];
}

export function evaluateCharacterBlocklist(
  character: FilterableCharacter,
  rules: ModerationRule[],
  blockedCreators: ModerationBlockedCreator[] = [],
): ModerationResult {
  const matches = rules
    .filter((rule) => rule.enabled && normalizeForMatch(rule.value).length > 0)
    .flatMap((rule) => matchRule(character, rule));

  for (const blockedCreator of blockedCreators) {
    if (!blockedCreator.enabled) continue;
    matches.push(...matchBlockedCreator(character, blockedCreator));
  }

  return { blocked: matches.length > 0, matches };
}

export function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/gu, " ");
}

export function formatBlockedReason(matches: ModerationMatch[]): string | null {
  if (matches.length === 0) return null;
  const first = matches[0];
  const field = first.matchedField.replaceAll(".", " ");
  const suffix = matches.length > 1 ? ` (+${matches.length - 1} more match${matches.length === 2 ? "" : "es"})` : "";
  return `Matched ${first.type} rule “${first.value}” in ${field}${suffix}.`;
}

function matchRule(character: FilterableCharacter, rule: ModerationRule): ModerationMatch[] {
  switch (rule.type) {
    case "CHARACTER_NAME":
      return phraseMatch(rule, "name", character.name);
    case "TAG": {
      const expected = normalizeForMatch(rule.value);
      const tag = character.tags.find(
        (candidate) => normalizeForMatch(candidate.name) === expected || normalizeForMatch(candidate.slug) === expected,
      );
      return tag ? [createMatch(rule, "tags", tag.name)] : [];
    }
    case "CREATOR_NAME":
      return firstSourcePhraseMatch(character, rule, "creatorName");
    case "CREATOR_ID": {
      const expected = normalizeForMatch(rule.value);
      const source = character.sources.find(
        (candidate) => candidate.externalCreatorId && normalizeForMatch(candidate.externalCreatorId) === expected,
      );
      return source?.externalCreatorId
        ? [createMatch(rule, "sources.externalCreatorId", source.externalCreatorId)]
        : [];
    }
    case "KEYWORD":
      return firstKeywordMatch(character, rule);
  }
}

function firstKeywordMatch(character: FilterableCharacter, rule: ModerationRule): ModerationMatch[] {
  const fields: Array<[string, string | null]> = [
    ["name", character.name],
    ["description", character.description],
    ["personality", character.personality],
    ["scenario", character.scenario],
    ["exampleDialogs", character.exampleDialogs],
    ...character.greetings.map((greeting, index) => [`greetings.${index}`, greeting] as [string, string]),
    ...character.tags.map((tag, index) => [`tags.${index}`, tag.name] as [string, string]),
  ];

  for (const [field, value] of fields) {
    const match = phraseMatch(rule, field, value);
    if (match.length > 0) return match;
  }
  return [];
}

function firstSourcePhraseMatch(
  character: FilterableCharacter,
  rule: ModerationRule,
  field: "creatorName",
): ModerationMatch[] {
  for (const source of character.sources) {
    const match = phraseMatch(rule, `sources.${field}`, source[field]);
    if (match.length > 0) return match;
  }
  return [];
}

function phraseMatch(rule: ModerationRule, field: string, value: string | null): ModerationMatch[] {
  if (!value || !containsBoundedPhrase(value, rule.value)) return [];
  return [createMatch(rule, field, value)];
}

function matchBlockedCreator(
  character: FilterableCharacter,
  blockedCreator: ModerationBlockedCreator,
): ModerationMatch[] {
  const expectedId = nullableNormalized(blockedCreator.externalCreatorId);
  const expectedName = nullableNormalized(blockedCreator.creatorName);
  if (!expectedId && !expectedName) return [];

  const source = character.sources.find((candidate) => {
    if (blockedCreator.platform && candidate.platform !== blockedCreator.platform) return false;
    if (expectedId && nullableNormalized(candidate.externalCreatorId) !== expectedId) return false;
    if (expectedName && nullableNormalized(candidate.creatorName) !== expectedName) return false;
    return true;
  });
  if (!source) return [];

  const matches: ModerationMatch[] = [];
  if (expectedId && source.externalCreatorId) {
    matches.push({
      ruleId: blockedCreator.id,
      type: "CREATOR_ID",
      value: blockedCreator.externalCreatorId!,
      matchedField: "sources.externalCreatorId",
      matchedValue: source.externalCreatorId,
    });
  }
  if (expectedName && source.creatorName) {
    matches.push({
      ruleId: blockedCreator.id,
      type: "CREATOR_NAME",
      value: blockedCreator.creatorName!,
      matchedField: "sources.creatorName",
      matchedValue: source.creatorName,
    });
  }
  return matches;
}

function containsBoundedPhrase(target: string, phrase: string): boolean {
  const normalizedTarget = normalizeForMatch(target);
  const normalizedPhrase = normalizeForMatch(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{Letter}\\p{Number}])${escaped}(?=$|[^\\p{Letter}\\p{Number}])`, "u")
    .test(normalizedTarget);
}

function createMatch(rule: ModerationRule, matchedField: string, matchedValue: string): ModerationMatch {
  return { ruleId: rule.id, type: rule.type, value: rule.value, matchedField, matchedValue };
}

function nullableNormalized(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeForMatch(value);
  return normalized.length > 0 ? normalized : null;
}
