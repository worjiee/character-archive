import { describe, expect, it, vi } from "vitest";
import { importJanitorCharacter } from "./import-character";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const CHARACTER_URL = `https://janitorai.com/characters/${CHARACTER_ID}_bride`;

describe("importJanitorCharacter", () => {
  it("parses, fetches, and normalizes one character", async () => {
    const source = {
      id: CHARACTER_ID,
      name: " Bride ",
      description: "A guarded heiress.",
      creator_id: "creator-1",
      creator_name: "Author",
      first_messages: ["Hello", "Welcome"],
      tags: [{ id: "tag-1", name: "Slow Burn" }],
      scripts: [{ id: "lore-1", type: "lorebook", title: "Family History" }],
      additional_field: { preserved: true },
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(source), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const normalized = await importJanitorCharacter(CHARACTER_URL, { fetch: fetchMock });

    expect(normalized).toMatchObject({
      externalId: CHARACTER_ID,
      platform: "JANITOR_AI",
      sourceUrl: CHARACTER_URL,
      name: "Bride",
      creator: { externalId: "creator-1", name: "Author" },
      greetings: [
        { content: "Hello", position: 0 },
        { content: "Welcome", position: 1 },
      ],
      tags: [{ externalId: "tag-1", name: "Slow Burn", slug: "slow-burn" }],
      lorebookReferences: [{ externalId: "lore-1", title: "Family History" }],
    });
    expect(normalized.rawData).toEqual(source);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
