import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FreshToolbar } from "./fresh-toolbar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("FreshToolbar", () => {
  it.each([
    ["freshest", "Freshest"],
    ["oldest", "Oldest activity"],
  ] as const)("keeps the complete %s sort label", (sort, label) => {
    const html = renderToStaticMarkup(<FreshToolbar window="24h" sort={sort} />);
    expect(html).toContain(`<option value="${sort}" selected="">${label}</option>`);
    expect(html).toContain("Freshest");
    expect(html).toContain("Oldest activity");
    expect(html).not.toContain("Oldest activit...");
  });
});
