import { describe, expect, it } from "vitest";
import { normalizeCharacterProse, normalizeSourceProse } from "./source-prose";

describe("source prose normalization", () => {
  it("decodes entities and preserves readable block, break, rule, list, and link text", () => {
    expect(normalizeSourceProse(
      '<h2>Profile &amp; notes</h2><p>First<br>Second</p><hr><ul><li>Read <a href="javascript:alert(1)">this</a></li></ul>',
    )).toBe("Profile & notes\n\nFirst\nSecond\n\nRead this");
  });

  it("removes executable/style content, images, attributes, and malformed markup", () => {
    expect(normalizeSourceProse(
      '<p onclick="bad()">Before<img src=x onerror="bad()"></p><script>alert(1)</script><style>body{display:none}</style><p><strong>After</p>',
    )).toBe("Before\n\nAfter");
  });

  it("preserves ordinary Unicode, template, comparison, and Markdown-like text", () => {
    const plain = "{{char}} **waves** — 2 < 3 and #Fantasy";
    expect(normalizeSourceProse(plain)).toBe(plain);
  });

  it("normalizes all canonical character prose fields through one policy", () => {
    expect(normalizeCharacterProse({
      description: "<p>Description</p>",
      personality: "<strong>Personality</strong>",
      scenario: "Scenario<br>line",
      exampleDialogs: "<span>Example</span>",
    })).toEqual({
      description: "Description",
      personality: "Personality",
      scenario: "Scenario\nline",
      exampleDialogs: "Example",
    });
  });
});
