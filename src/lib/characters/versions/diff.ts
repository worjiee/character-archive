import type {
  CanonicalCharacterSnapshot,
  CharacterVersionDiffResult,
  FieldDiff,
} from "./types";
import { effectiveProse } from "./fingerprint";

function makeFieldDiff<T>(before: T, after: T): FieldDiff<T> {
  const changed = before !== after;
  return { changed, before, after };
}

/**
 * Computes a structured, field-level difference between two canonical character snapshots.
 */
export function compareCharacterSnapshots(
  fromSnapshot: CanonicalCharacterSnapshot,
  toSnapshot: CanonicalCharacterSnapshot,
  options: { fromVersion?: number; toVersion?: number } = {},
): CharacterVersionDiffResult {
  const fromChar = fromSnapshot.character;
  const toChar = toSnapshot.character;

  const fromEffName =
    effectiveProse(fromChar.overrides?.nameOverride, fromChar.name) ??
    fromChar.name;
  const toEffName =
    effectiveProse(toChar.overrides?.nameOverride, toChar.name) ?? toChar.name;

  const fromEffDesc = effectiveProse(
    fromChar.overrides?.descriptionOverride,
    fromChar.description,
  );
  const toEffDesc = effectiveProse(
    toChar.overrides?.descriptionOverride,
    toChar.description,
  );

  const fromEffPers = effectiveProse(
    fromChar.overrides?.personalityOverride,
    fromChar.personality,
  );
  const toEffPers = effectiveProse(
    toChar.overrides?.personalityOverride,
    toChar.personality,
  );

  const fromEffScen = effectiveProse(
    fromChar.overrides?.scenarioOverride,
    fromChar.scenario,
  );
  const toEffScen = effectiveProse(
    toChar.overrides?.scenarioOverride,
    toChar.scenario,
  );

  const fromEffAvatar = effectiveProse(
    fromChar.overrides?.avatarUrlOverride,
    fromChar.avatarUrl,
  );
  const toEffAvatar = effectiveProse(
    toChar.overrides?.avatarUrlOverride,
    toChar.avatarUrl,
  );

  const fields = {
    name: makeFieldDiff(fromEffName, toEffName),
    description: makeFieldDiff(fromEffDesc, toEffDesc),
    personality: makeFieldDiff(fromEffPers, toEffPers),
    scenario: makeFieldDiff(fromEffScen, toEffScen),
    exampleDialogs: makeFieldDiff(
      fromChar.exampleDialogs ?? null,
      toChar.exampleDialogs ?? null,
    ),
    avatarUrl: makeFieldDiff(fromEffAvatar, toEffAvatar),
    systemPrompt: makeFieldDiff(
      fromSnapshot.promptExtensions.systemPrompt ?? null,
      toSnapshot.promptExtensions.systemPrompt ?? null,
    ),
    postHistoryInstructions: makeFieldDiff(
      fromSnapshot.promptExtensions.postHistoryInstructions ?? null,
      toSnapshot.promptExtensions.postHistoryInstructions ?? null,
    ),
  };

  // Artwork
  const fromArt = fromSnapshot.artwork.sha256 ?? null;
  const toArt = toSnapshot.artwork.sha256 ?? null;
  const artworkChanged = fromArt !== toArt;
  const artwork = {
    changed: artworkChanged,
    beforeSha256: fromArt,
    afterSha256: toArt,
  };

  // Tokens
  const beforeTokens = fromSnapshot.tokenMetrics.tokenCount ?? null;
  const afterTokens = toSnapshot.tokenMetrics.tokenCount ?? null;
  const tokenDelta =
    beforeTokens !== null && afterTokens !== null
      ? afterTokens - beforeTokens
      : null;

  const beforePermTokens =
    fromSnapshot.tokenMetrics.permanentTokenCount ?? null;
  const afterPermTokens = toSnapshot.tokenMetrics.permanentTokenCount ?? null;
  const permTokenDelta =
    beforePermTokens !== null && afterPermTokens !== null
      ? afterPermTokens - beforePermTokens
      : null;

  const tokens = {
    beforeTokenCount: beforeTokens,
    afterTokenCount: afterTokens,
    tokenDelta,
    beforePermanentTokenCount: beforePermTokens,
    afterPermanentTokenCount: afterPermTokens,
    permanentTokenDelta: permTokenDelta,
  };

  // Greetings
  const fromGreetings = fromSnapshot.greetings;
  const toGreetings = toSnapshot.greetings;

  const addedGreetings: Array<{ position: number; content: string }> = [];
  const removedGreetings: Array<{ position: number; content: string }> = [];
  const modifiedGreetings: Array<{
    position: number;
    beforeContent: string;
    afterContent: string;
  }> = [];

  const commonCount = Math.min(fromGreetings.length, toGreetings.length);
  for (let i = 0; i < commonCount; i++) {
    if (fromGreetings[i].content !== toGreetings[i].content) {
      modifiedGreetings.push({
        position: i,
        beforeContent: fromGreetings[i].content,
        afterContent: toGreetings[i].content,
      });
    }
  }

  for (let i = commonCount; i < toGreetings.length; i++) {
    addedGreetings.push({ position: i, content: toGreetings[i].content });
  }

  for (let i = commonCount; i < fromGreetings.length; i++) {
    removedGreetings.push({ position: i, content: fromGreetings[i].content });
  }

  const fromContentsSorted = [...fromGreetings.map((g) => g.content)].sort();
  const toContentsSorted = [...toGreetings.map((g) => g.content)].sort();
  const reorderedGreetings =
    fromGreetings.length === toGreetings.length &&
    fromContentsSorted.every((c, idx) => c === toContentsSorted[idx]) &&
    fromGreetings.some((g, idx) => g.content !== toGreetings[idx]?.content);

  const greetingsChanged =
    addedGreetings.length > 0 ||
    removedGreetings.length > 0 ||
    modifiedGreetings.length > 0 ||
    fromGreetings.some((g, idx) => toGreetings[idx]?.hidden !== g.hidden);

  const greetings = {
    changed: greetingsChanged,
    countBefore: fromGreetings.length,
    countAfter: toGreetings.length,
    added: addedGreetings,
    removed: removedGreetings,
    modified: modifiedGreetings,
    reordered: reorderedGreetings,
  };

  // Tags
  const fromTagMap = new Map(fromSnapshot.tags.map((t) => [t.slug, t.name]));
  const toTagMap = new Map(toSnapshot.tags.map((t) => [t.slug, t.name]));

  const addedTags: string[] = [];
  const removedTags: string[] = [];
  const unchangedTags: string[] = [];

  for (const [slug, name] of toTagMap.entries()) {
    if (!fromTagMap.has(slug)) {
      addedTags.push(name);
    } else {
      unchangedTags.push(name);
    }
  }
  for (const [slug, name] of fromTagMap.entries()) {
    if (!toTagMap.has(slug)) {
      removedTags.push(name);
    }
  }
  addedTags.sort();
  removedTags.sort();
  unchangedTags.sort();

  const tagsChanged = addedTags.length > 0 || removedTags.length > 0;
  const tags = {
    changed: tagsChanged,
    added: addedTags,
    removed: removedTags,
    unchanged: unchangedTags,
  };

  // Lorebooks
  const fromLbMap = new Map(
    fromSnapshot.lorebooks.map((lb) => [lb.externalId, lb]),
  );
  const toLbMap = new Map(toSnapshot.lorebooks.map((lb) => [lb.externalId, lb]));

  const addedLorebooks: string[] = [];
  const removedLorebooks: string[] = [];
  const modifiedLorebooks: Array<{
    title: string;
    entriesAdded: number;
    entriesRemoved: number;
    entriesModified: number;
  }> = [];

  for (const [extId, lb] of toLbMap.entries()) {
    if (!fromLbMap.has(extId)) {
      addedLorebooks.push(lb.title);
    } else {
      const fromLb = fromLbMap.get(extId)!;
      const fromEntries = new Map(
        fromLb.entries.map((e) => [e.externalEntryId, e]),
      );
      const toEntries = new Map(lb.entries.map((e) => [e.externalEntryId, e]));

      let eAdded = 0;
      let eRemoved = 0;
      let eMod = 0;

      for (const [eId, entry] of toEntries.entries()) {
        if (!fromEntries.has(eId)) {
          eAdded++;
        } else {
          const prev = fromEntries.get(eId)!;
          if (
            prev.content !== entry.content ||
            prev.keys.join(",") !== entry.keys.join(",") ||
            prev.enabled !== entry.enabled ||
            prev.insertionOrder !== entry.insertionOrder
          ) {
            eMod++;
          }
        }
      }
      for (const eId of fromEntries.keys()) {
        if (!toEntries.has(eId)) {
          eRemoved++;
        }
      }

      if (
        fromLb.title !== lb.title ||
        fromLb.description !== lb.description ||
        eAdded > 0 ||
        eRemoved > 0 ||
        eMod > 0
      ) {
        modifiedLorebooks.push({
          title: lb.title,
          entriesAdded: eAdded,
          entriesRemoved: eRemoved,
          entriesModified: eMod,
        });
      }
    }
  }

  for (const [extId, lb] of fromLbMap.entries()) {
    if (!toLbMap.has(extId)) {
      removedLorebooks.push(lb.title);
    }
  }

  const lorebooksChanged =
    addedLorebooks.length > 0 ||
    removedLorebooks.length > 0 ||
    modifiedLorebooks.length > 0;

  let lbSummary = "Unchanged";
  if (lorebooksChanged) {
    const parts: string[] = [];
    if (addedLorebooks.length > 0)
      parts.push(`${addedLorebooks.length} lorebook(s) added`);
    if (removedLorebooks.length > 0)
      parts.push(`${removedLorebooks.length} lorebook(s) removed`);
    if (modifiedLorebooks.length > 0)
      parts.push(`${modifiedLorebooks.length} lorebook(s) updated`);
    lbSummary = parts.join(", ");
  }

  const lorebooks = {
    changed: lorebooksChanged,
    summary: lbSummary,
    addedLorebooks,
    removedLorebooks,
    modifiedLorebooks,
  };

  let changedFieldCount = 0;
  for (const f of Object.values(fields)) {
    if (f.changed) changedFieldCount++;
  }
  if (artworkChanged) changedFieldCount++;
  if (greetingsChanged) changedFieldCount++;
  if (tagsChanged) changedFieldCount++;
  if (lorebooksChanged) changedFieldCount++;

  const hasChanges = changedFieldCount > 0;

  return {
    fromVersion: options.fromVersion ?? 0,
    toVersion: options.toVersion ?? 0,
    hasChanges,
    changedFieldCount,
    fields,
    tokens,
    artwork,
    greetings,
    tags,
    lorebooks,
  };
}
