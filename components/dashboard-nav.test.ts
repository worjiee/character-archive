import { describe, expect, it } from "vitest";
import {
  isNavigationItemActive,
  primaryNavigation,
} from "./dashboard-nav";

describe("dashboard primary navigation", () => {
  it("exposes the supported archive destinations without fake source routes", () => {
    expect(primaryNavigation.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/", label: "Home" },
      { href: "/characters", label: "Characters" },
      { href: "/lorebooks", label: "Lorebooks" },
      { href: "/authors", label: "Authors" },
    ]);
  });

  it("marks Home active only at the archive root", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/characters", "/")).toBe(false);
  });

  it("marks character and lorebook index/detail routes active", () => {
    expect(isNavigationItemActive("/characters", "/characters")).toBe(true);
    expect(isNavigationItemActive("/characters/character-1", "/characters")).toBe(true);
    expect(isNavigationItemActive("/lorebooks", "/lorebooks")).toBe(true);
    expect(isNavigationItemActive("/lorebooks/lorebook-1", "/lorebooks")).toBe(true);
    expect(isNavigationItemActive("/authors", "/authors")).toBe(true);
    expect(isNavigationItemActive("/authors/JANITOR_AI/creator-1", "/authors")).toBe(true);
    expect(isNavigationItemActive("/settings", "/characters")).toBe(false);
  });
});
