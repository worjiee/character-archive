import { describe, expect, it } from "vitest";
import { normalizeJanitorSourceText } from "./normalize-source-text";

describe("normalizeJanitorSourceText", () => {
  it("preserves paragraph separation", () => {
    expect(normalizeJanitorSourceText("<p>Hello</p><p>World</p>"))
      .toBe("Hello\n\nWorld");
  });

  it("converts br variants to newlines", () => {
    expect(normalizeJanitorSourceText("Hello<br>World<br/>Again<br />Done"))
      .toBe("Hello\nWorld\nAgain\nDone");
  });

  it("keeps text from supported inline formatting", () => {
    expect(normalizeJanitorSourceText(
      '<strong>Bold</strong> <em>emphasis</em> <u>underline</u> <mark>marked</mark> <span style="color:red">styled</span>',
    )).toBe("Bold emphasis underline marked styled");
  });

  it("decodes common named and numeric HTML entities", () => {
    expect(normalizeJanitorSourceText("Tom &amp; Jerry &lt;3 &copy; &#169; &#x1F600; &nbsp; done"))
      .toBe("Tom & Jerry <3 © © 😀 done");
  });

  it("handles nested formatting and unsupported tags while retaining text", () => {
    expect(normalizeJanitorSourceText("<custom><strong>Hello <em>nested</em></strong></custom>"))
      .toBe("Hello nested");
  });

  it.each(["script", "style", "template", "noscript"])(
    "removes %s elements together with their content",
    (tag) => {
      expect(normalizeJanitorSourceText(`<p>Before</p><${tag}>unsafe content</${tag}><p>After</p>`))
        .toBe("Before\n\nAfter");
    },
  );

  it("removes encoded or unclosed executable markup conservatively", () => {
    expect(normalizeJanitorSourceText(
      "<p>Before</p>&lt;script&gt;unsafe&lt;/script&gt;<script>unfinished",
    )).toBe("Before");
  });

  it("discards event-handler attributes without interpreting them", () => {
    expect(normalizeJanitorSourceText(
      '<span onclick="alert(1)" onmouseover="doBadThing()">Readable</span>',
    )).toBe("Readable");
  });

  it("handles malformed but representable HTML", () => {
    expect(normalizeJanitorSourceText("<p>Hello <strong>world</p><p>Again"))
      .toBe("Hello world\n\nAgain");
  });

  it("leaves ordinary plain text and template syntax unchanged", () => {
    const value = "{{char}} says hello to {{user}} — punctuation stays.";
    expect(normalizeJanitorSourceText(value)).toBe(value);
  });

  it("normalizes excessive horizontal and vertical whitespace", () => {
    expect(normalizeJanitorSourceText(" \n\n\n Hello   world \n\n\n\n {{char}}\t says hi \n "))
      .toBe("Hello world\n\n{{char}} says hi");
  });

  it("removes comments, links, and horizontal-rule markup safely", () => {
    expect(normalizeJanitorSourceText(
      '<p>Read <a href="https://example.test">this</a></p><!-- hidden --><hr><p>Next</p>',
    )).toBe("Read this\n\nNext");
  });
});
