import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("LoginForm", () => {
  it("truthfully requests a username while preserving login semantics", () => {
    const html = renderToStaticMarkup(<LoginForm redirectTo="/characters" />);

    expect(html).toContain(">Username<");
    expect(html).not.toContain("Username or email");
    expect(html).toContain('name="username"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Sign in →");
  });
});
