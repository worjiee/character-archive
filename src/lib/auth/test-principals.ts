import type { AuthenticatedPrincipal } from "./session";

export const TEST_ADMIN_PRINCIPAL: AuthenticatedPrincipal = {
  userId: "initial-admin",
  username: "admin@example.com",
  displayName: "Admin",
  role: "ADMIN",
};

export const TEST_MEMBER_PRINCIPAL: AuthenticatedPrincipal = {
  userId: "member-1",
  username: "member@example.com",
  displayName: "Member",
  role: "MEMBER",
};
