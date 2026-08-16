import {
  importJanitorCharacter,
  JanitorNormalizationError,
  JanitorRetrievalError,
} from "../src/lib/importers/janitor";

const PUBLIC_CHARACTER_URL =
  "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron-dku-edition";

async function main(): Promise<void> {
  try {
    const character = await importJanitorCharacter(PUBLIC_CHARACTER_URL);
    const safeSummary = {
      externalId: character.externalId,
      name: character.name,
      creator: character.creator,
      greetingCount: character.greetings.length,
      tags: character.tags,
      lorebookReferences: character.lorebookReferences,
    };

    console.log(JSON.stringify(safeSummary, null, 2));
  } catch (error) {
    if (error instanceof JanitorRetrievalError) {
      console.error(
        JSON.stringify(
          {
            error: {
              type: error.name,
              code: error.code,
              ...(error.status === undefined ? {} : { status: error.status }),
            },
          },
          null,
          2,
        ),
      );
    } else if (error instanceof JanitorNormalizationError) {
      console.error(
        JSON.stringify(
          { error: { type: error.name, code: error.code } },
          null,
          2,
        ),
      );
    } else {
      console.error(JSON.stringify({ error: { type: "UNKNOWN_ERROR" } }, null, 2));
    }

    process.exitCode = 1;
  }
}

void main();
