import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DashboardNav,
  isManagementLinkActive,
  isNavigationItemActive,
  isUtilityRouteActive,
  managementGroupsForRole,
  managementActionState,
  primaryNavigation,
  transientHeaderReducer,
} from "./dashboard-nav";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import { NotificationsProvider } from "./notifications-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("dashboard primary navigation", () => {
  it("exposes the supported archive destinations without fake source routes", () => {
    expect(primaryNavigation.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/", label: "Fresh" },
      { href: "/characters", label: "Characters" },
      { href: "/authors", label: "Authors" },
      { href: "/lorebooks", label: "Lorebooks" },
    ]);
  });

  it("marks Fresh active only at the archive root", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/characters", "/")).toBe(false);
  });

  it("keeps the special management action separate from the active Fresh route", () => {
    const html = renderNav();
    const freshLink = html.match(/<a aria-current="page"[^>]*href="\/"[^>]*>/)?.[0];
    expect(freshLink).toBeDefined();
    expect(html).toContain('class="management-action archive-focus"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<summary[^>]*aria-current/);
    expect(managementActionState(false)).toBe("closed");
    expect(managementActionState(true)).toBe("open");
    expect(isNavigationItemActive("/", "/")).toBe(true);
  });

  it("keeps Settings neutral at Fresh while retaining its accessible name", () => {
    const html = renderNav();
    const settingsLink = html.match(/<a aria-label="Settings"[^>]*>/)?.[0];
    expect(isUtilityRouteActive("/", "/settings")).toBe(false);
    expect(isUtilityRouteActive("/settings", "/settings")).toBe(true);
    expect(settingsLink).toContain('title="Settings"');
    expect(settingsLink).toContain('href="/settings"');
    expect(settingsLink).toContain('class="header-utility-control archive-focus"');
    expect(settingsLink).not.toContain("aria-current");
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

  it.each(["Fresh", "Characters", "Authors", "Lorebooks", "Settings", "Import character"])(
    "dismisses Add & Manage when the %s destination is selected",
    () => {
      const openState = transientHeaderReducer(
        { addManageOpen: false, mobileMenuOpen: false },
        { type: "set-add-manage", open: true },
      );
      expect(openState.addManageOpen).toBe(true);
      expect(managementActionState(openState.addManageOpen)).toBe("open");

      const dismissedState = transientHeaderReducer(openState, { type: "dismiss" });
      expect(dismissedState).toEqual({ addManageOpen: false, mobileMenuOpen: false });
      expect(managementActionState(dismissedState.addManageOpen)).toBe("closed");
    },
  );

  it("keeps desktop and mobile transient menus mutually exclusive and closed after navigation", () => {
    const managementOpen = transientHeaderReducer(
      { addManageOpen: false, mobileMenuOpen: true },
      { type: "set-add-manage", open: true },
    );
    expect(managementOpen).toEqual({ addManageOpen: true, mobileMenuOpen: false });

    const mobileOpen = transientHeaderReducer(managementOpen, { type: "set-mobile-menu", open: true });
    expect(mobileOpen).toEqual({ addManageOpen: false, mobileMenuOpen: true });
    expect(transientHeaderReducer(mobileOpen, { type: "dismiss" })).toEqual({
      addManageOpen: false,
      mobileMenuOpen: false,
    });
  });

  it("does not treat an import route as an open or route-active Add & Manage state", () => {
    expect(primaryNavigation.some(({ href }) => href === "/import")).toBe(false);
    expect(managementActionState(false)).toBe("closed");
    expect(isNavigationItemActive("/import", "/")).toBe(false);
  });

  it("identifies every moderation destination by its exact pathname", () => {
    expect(isManagementLinkActive("/import", "", "/import")).toBe(true);
    expect(isManagementLinkActive("/characters/character-1", "", "/characters")).toBe(true);
    expect(isManagementLinkActive("/blocked", "", "/blocked")).toBe(true);
    expect(isManagementLinkActive("/blocked/quarantine", "", "/blocked/quarantine")).toBe(true);
    expect(isManagementLinkActive("/blocked/rules", "", "/blocked/rules")).toBe(true);
    expect(isManagementLinkActive("/blocked/creators", "", "/blocked/creators")).toBe(true);
    expect(isManagementLinkActive("/blocked/quarantine", "", "/blocked")).toBe(false);
    expect(isManagementLinkActive("/blocked/quarantine", "", "/blocked/rules")).toBe(false);
    expect(isManagementLinkActive("/settings", "#deleted-characters", "/settings#deleted-characters")).toBe(true);
    expect(isManagementLinkActive("/settings", "#deleted-characters", "/settings")).toBe(false);
  });

  it("renders every mega-menu entry through the shared row style", () => {
    const html = renderNav();
    expect(html.match(/management-menu-item archive-focus/g)).toHaveLength(17);
    for (const label of ["Overview", "Quarantine", "Block rules", "Blocked creators"]) {
      expect(html).toMatch(new RegExp(`class="management-menu-item archive-focus"[^>]*>${label}</a>`));
    }
  });

  it("renders all navigation dismissal targets while the management action starts closed", () => {
    const html = renderNav();
    for (const href of ["/", "/characters", "/authors", "/lorebooks", "/settings", "/import"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps administrative navigation out of the MEMBER header and management menu", () => {
    const html = renderNav({ favoriteIds: [], cartIds: [] }, "MEMBER");
    expect(managementGroupsForRole("MEMBER").map(({ label }) => label)).toEqual(["Import", "Library"]);
    expect(html).toContain('href="/import"');
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('href="/blocked"');
    expect(html).not.toContain("Block rules");
  });

  it("exposes compact Favorites and Cart access with truthful non-zero counts", () => {
    const html = renderNav();
    expect(html).toContain('href="/favorites"');
    expect(html).toContain('aria-label="Favorites 1"');
    expect(html).toContain('href="/cart"');
    expect(html).toContain('aria-label="Cart 2"');
  });

  it("renders header counts from only the supplied current-user collection state", () => {
    const userA = renderNav({ favoriteIds: ["a", "b"], cartIds: [] });
    const userB = renderNav({ favoriteIds: [], cartIds: ["c"] });
    expect(userA).toContain('aria-label="Favorites 2"');
    expect(userA).toContain('aria-label="Cart"');
    expect(userB).toContain('aria-label="Favorites"');
    expect(userB).toContain('aria-label="Cart 1"');
  });
});

function renderNav(initialState = { favoriteIds: ["favorite-1"], cartIds: ["cart-1", "cart-2"] }, role: "ADMIN" | "MEMBER" = "ADMIN"): string {
  return renderToStaticMarkup(
    createElement(
      CharacterCollectionsProvider,
      { initialState },
      createElement(
        NotificationsProvider,
        { initialFeed: { items: [], unreadCount: 0, nextCursor: null, generatedAt: "2026-09-05T12:00:00.000Z" } },
        createElement(DashboardNav, { role }),
      ),
    ),
  );
}
