import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LorebookNotFound from "./not-found";

describe("lorebook not-found route", () => {
  it("renders a truthful missing-record state with a library return link", () => {
    const markup = renderToStaticMarkup(<LorebookNotFound />);
    expect(markup).toContain("Lorebook unavailable");
    expect(markup).toContain('href="/lorebooks"');
  });
});
