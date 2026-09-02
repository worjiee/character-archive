import { randomUUID } from "node:crypto";
import { generatePasswordHash, normalizeUsername, PasswordHashError } from "../auth/password";
import { INITIAL_ADMIN_USER_ID } from "../auth/authorization";

export type ManagedUserRole = "ADMIN" | "MEMBER";
export type ManagedUserAccessStatus = "ACTIVE" | "REVOKED";

export interface ManagedUserDto {
  id: string;
  username: string;
  displayName: string | null;
  role: ManagedUserRole;
  accessStatus: ManagedUserAccessStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type UserManagementErrorCode =
  | "USERNAME_TAKEN"
  | "INVALID_USERNAME"
  | "INVALID_DISPLAY_NAME"
  | "INVALID_PASSWORD"
  | "INVALID_REQUEST"
  | "INVALID_USER_ID"
  | "USER_NOT_FOUND"
  | "ALREADY_REVOKED"
  | "ALREADY_ACTIVE"
  | "PROTECTED_ADMIN";

export class UserManagementError extends Error {
  constructor(
    readonly code: UserManagementErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "UserManagementError";
  }
}

interface UserManagementClient {
  user: {
    findMany(args: unknown): Promise<ManagedUserDto[]>;
    findUnique(args: unknown): Promise<{
      id: string;
      role: ManagedUserRole;
      accessStatus: ManagedUserAccessStatus;
    } | null>;
    create(args: unknown): Promise<ManagedUserDto>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<ManagedUserDto>;
  };
  userSession: {
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(operation: (transaction: UserManagementClient) => Promise<T>): Promise<T>;
}

const managedUserSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  accessStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listManagedUsers(client?: UserManagementClient): Promise<ManagedUserDto[]> {
  const database = client ?? await defaultClient();
  return database.user.findMany({
    select: managedUserSelect,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }, { username: "asc" }],
  });
}

export async function createMember(
  value: unknown,
  client?: UserManagementClient,
): Promise<ManagedUserDto> {
  const input = parseCreateMemberInput(value);
  const passwordHash = await hashReplacementPassword(input.password);
  const database = client ?? await defaultClient();

  try {
    return await database.user.create({
      data: {
        id: randomUUID(),
        username: input.username,
        normalizedUsername: input.normalizedUsername,
        displayName: input.displayName,
        passwordHash,
        role: "MEMBER",
        accessStatus: "ACTIVE",
      },
      select: managedUserSelect,
    });
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      throw new UserManagementError(
        "USERNAME_TAKEN",
        "That username is already in use.",
        409,
      );
    }
    throw error;
  }
}

export async function revokeMember(
  targetUserId: unknown,
  client?: UserManagementClient,
): Promise<ManagedUserDto> {
  const userId = parseTargetUserId(targetUserId);
  const database = client ?? await defaultClient();
  return database.$transaction(async (transaction) => {
    const target = await requireMutableMember(transaction, userId);
    if (target.accessStatus === "REVOKED") {
      throw new UserManagementError("ALREADY_REVOKED", "This member is already revoked.", 409);
    }

    const updated = await transaction.user.updateMany({
      where: { id: userId, role: "MEMBER", accessStatus: "ACTIVE" },
      data: { accessStatus: "REVOKED" },
    });
    if (updated.count !== 1) {
      throw new UserManagementError("ALREADY_REVOKED", "This member is already revoked.", 409);
    }
    await transaction.userSession.deleteMany({ where: { userId } });
    return requireManagedUser(transaction, userId);
  });
}

export async function reactivateMember(
  targetUserId: unknown,
  client?: UserManagementClient,
): Promise<ManagedUserDto> {
  const userId = parseTargetUserId(targetUserId);
  const database = client ?? await defaultClient();
  return database.$transaction(async (transaction) => {
    const target = await requireMutableMember(transaction, userId);
    if (target.accessStatus === "ACTIVE") {
      throw new UserManagementError("ALREADY_ACTIVE", "This member is already active.", 409);
    }

    const updated = await transaction.user.updateMany({
      where: { id: userId, role: "MEMBER", accessStatus: "REVOKED" },
      data: { accessStatus: "ACTIVE" },
    });
    if (updated.count !== 1) {
      throw new UserManagementError("ALREADY_ACTIVE", "This member is already active.", 409);
    }
    await transaction.userSession.deleteMany({ where: { userId } });
    return requireManagedUser(transaction, userId);
  });
}

export async function resetMemberPassword(
  targetUserId: unknown,
  value: unknown,
  client?: UserManagementClient,
): Promise<ManagedUserDto> {
  const userId = parseTargetUserId(targetUserId);
  const input = parseResetPasswordInput(value);
  const passwordHash = await hashReplacementPassword(input.password);
  const database = client ?? await defaultClient();

  return database.$transaction(async (transaction) => {
    await requireMutableMember(transaction, userId);
    const user = await transaction.user.update({
      where: { id: userId },
      data: { passwordHash },
      select: managedUserSelect,
    });
    await transaction.userSession.deleteMany({ where: { userId } });
    return user;
  });
}

function parseCreateMemberInput(value: unknown): {
  username: string;
  normalizedUsername: string;
  displayName: string | null;
  password: string;
} {
  const input = exactRecord(value, ["username", "displayName", "password", "confirmPassword"]);
  const username = parseUsername(input.username);
  const password = parseConfirmedPassword(input.password, input.confirmPassword);
  return {
    username,
    normalizedUsername: normalizeUsername(username),
    displayName: parseDisplayName(input.displayName),
    password,
  };
}

function parseResetPasswordInput(value: unknown): { password: string } {
  const input = exactRecord(value, ["password", "confirmPassword"]);
  return { password: parseConfirmedPassword(input.password, input.confirmPassword) };
}

function parseUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new UserManagementError("INVALID_USERNAME", "Username is required.");
  }
  const username = value.normalize("NFKC").trim();
  const normalized = normalizeUsername(username);
  if (!username || !normalized || username.length > 320 || normalized.length > 320 || /[\u0000-\u001f\u007f]/u.test(username)) {
    throw new UserManagementError("INVALID_USERNAME", "Enter a valid username of 320 characters or fewer.");
  }
  return username;
}

function parseDisplayName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new UserManagementError("INVALID_DISPLAY_NAME", "Display name must be text.");
  }
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!displayName) return null;
  if (displayName.length > 160 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw new UserManagementError("INVALID_DISPLAY_NAME", "Display name must be 160 characters or fewer.");
  }
  return displayName;
}

function parseConfirmedPassword(password: unknown, confirmation: unknown): string {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new UserManagementError(
      "INVALID_PASSWORD",
      "Password must contain between 12 and 1024 characters.",
    );
  }
  if (typeof confirmation !== "string" || password !== confirmation) {
    throw new UserManagementError("INVALID_PASSWORD", "Passwords do not match.");
  }
  return password;
}

async function hashReplacementPassword(password: string): Promise<string> {
  try {
    return await generatePasswordHash(password);
  } catch (error) {
    if (error instanceof PasswordHashError) {
      throw new UserManagementError("INVALID_PASSWORD", "Password does not meet the required policy.");
    }
    throw error;
  }
}

function parseTargetUserId(value: unknown): string {
  if (typeof value !== "string") {
    throw new UserManagementError("INVALID_USER_ID", "A valid target user is required.");
  }
  const userId = value.trim();
  if (!userId || userId.length > 128 || /[\u0000-\u001f\u007f]/u.test(userId)) {
    throw new UserManagementError("INVALID_USER_ID", "A valid target user is required.");
  }
  return userId;
}

async function requireMutableMember(
  database: UserManagementClient,
  userId: string,
): Promise<{ id: string; role: ManagedUserRole; accessStatus: ManagedUserAccessStatus }> {
  const target = await database.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, accessStatus: true },
  });
  if (!target) throw new UserManagementError("USER_NOT_FOUND", "User not found.", 404);
  if (target.id === INITIAL_ADMIN_USER_ID || target.role !== "MEMBER") {
    throw new UserManagementError("PROTECTED_ADMIN", "Administrator accounts are protected.", 403);
  }
  return target;
}

async function requireManagedUser(
  database: UserManagementClient,
  userId: string,
): Promise<ManagedUserDto> {
  const users = await database.user.findMany({
    where: { id: userId },
    select: managedUserSelect,
    take: 1,
  });
  const user = users[0];
  if (!user) throw new UserManagementError("USER_NOT_FOUND", "User not found.", 404);
  return user;
}

function exactRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserManagementError("INVALID_REQUEST", "The request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new UserManagementError("INVALID_REQUEST", "The request contains unsupported fields.");
  }
  return record;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === code;
}

async function defaultClient(): Promise<UserManagementClient> {
  const { prisma } = await import("../../../lib/prisma");
  return prisma as unknown as UserManagementClient;
}
