import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccessManagementDashboard } from "./access-management-dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("AccessManagementDashboard", () => {
  it("renders a dense authorized-user list with protected ADMIN and contextual MEMBER actions", () => {
    const html = renderToStaticMarkup(createElement(AccessManagementDashboard, { users: [
      {
        id: "initial-admin",
        username: "client",
        displayName: "Client",
        role: "ADMIN",
        accessStatus: "ACTIVE",
        createdAt: new Date("2026-08-28T05:00:00.000Z"),
        updatedAt: new Date("2026-08-28T05:00:00.000Z"),
      },
      {
        id: "member-active",
        username: "friend-one",
        displayName: "Friend One",
        role: "MEMBER",
        accessStatus: "ACTIVE",
        createdAt: new Date("2026-08-28T06:00:00.000Z"),
        updatedAt: new Date("2026-08-28T06:00:00.000Z"),
      },
      {
        id: "member-revoked",
        username: "friend-two",
        displayName: "Friend Two",
        role: "MEMBER",
        accessStatus: "REVOKED",
        createdAt: new Date("2026-08-28T07:00:00.000Z"),
        updatedAt: new Date("2026-08-28T07:00:00.000Z"),
      },
    ] }));

    expect(html).toContain("Authorized users");
    expect(html).toContain("3 users");
    expect(html).toContain('href="/settings/access"');
    expect(html).toContain("Protected");
    expect(html).toContain("Reset password");
    expect(html).toContain("Revoke");
    expect(html).toContain("Reactivate");
    expect(html.match(/>Protected</gu)).toHaveLength(1);
    expect(html).toContain("Aug 28, 2026");
  });

  it("formats user creation date deterministically using UTC regardless of local timezone", () => {
    const html = renderToStaticMarkup(createElement(AccessManagementDashboard, { users: [
      {
        id: "utc-test-user",
        username: "utc-user",
        displayName: "UTC User",
        role: "MEMBER",
        accessStatus: "ACTIVE",
        createdAt: new Date("2026-12-31T23:59:59.000Z"),
        updatedAt: new Date("2026-12-31T23:59:59.000Z"),
      },
    ] }));

    // In UTC this is Dec 31, 2026, regardless of local system timezone
    expect(html).toContain("Dec 31, 2026");
  });
});
