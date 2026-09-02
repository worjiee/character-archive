import { describe, expect, it } from "vitest";
import { verifyPassword } from "../auth/password";
import {
  createMember,
  listManagedUsers,
  reactivateMember,
  resetMemberPassword,
  revokeMember,
  type ManagedUserAccessStatus,
  type ManagedUserDto,
  type ManagedUserRole,
} from "./access-management";

describe("administrative user access management", () => {
  it("lists only the approved management projection", async () => {
    const database = fakeDatabase();
    const users = await listManagedUsers(database);
    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]).sort()).toEqual([
      "accessStatus", "createdAt", "displayName", "id", "role", "updatedAt", "username",
    ]);
    expect(JSON.stringify(users)).not.toContain("passwordHash");
    expect(JSON.stringify(users)).not.toContain("sessions");
    expect(JSON.stringify(users)).not.toContain("favorites");
    expect(JSON.stringify(users)).not.toContain("cartItems");
  });

  it("creates only ACTIVE MEMBER accounts with normalized unique identities and scrypt hashes", async () => {
    const database = fakeDatabase();
    const plaintext = "member password phrase";
    const member = await createMember({
      username: " Friend ",
      displayName: "  Friend   One ",
      password: plaintext,
      confirmPassword: plaintext,
    }, database);

    expect(member).toMatchObject({ username: "Friend", displayName: "Friend One", role: "MEMBER", accessStatus: "ACTIVE" });
    const stored = database.records.get(member.id)!;
    expect(stored.normalizedUsername).toBe("friend");
    expect(stored.passwordHash).toMatch(/^scrypt:/u);
    expect(stored.passwordHash).not.toContain(plaintext);
    await expect(verifyPassword(plaintext, stored.passwordHash)).resolves.toBe(true);
    expect(database.sessions.filter(({ userId }) => userId === member.id)).toHaveLength(0);
    expect(database.favorites.filter(({ userId }) => userId === member.id)).toHaveLength(0);
    expect(database.cartItems.filter(({ userId }) => userId === member.id)).toHaveLength(0);

    await expect(createMember({
      username: "Ｆｒｉｅｎｄ",
      password: "another password phrase",
      confirmPassword: "another password phrase",
    }, database)).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
  });

  it("enforces password policy, confirmation, and strict unknown-field rejection", async () => {
    const database = fakeDatabase();
    await expect(createMember({ username: "member", password: "short", confirmPassword: "short" }, database)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(createMember({ username: "member", password: "long enough password", confirmPassword: "different password" }, database)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(createMember({ username: "member", password: "long enough password", confirmPassword: "long enough password", role: "ADMIN" }, database)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("revokes a MEMBER atomically, deletes sessions, and preserves private collections", async () => {
    const database = fakeDatabase();
    const member = await seedMember(database);
    database.sessions.push({ tokenHash: "token-1", userId: member.id });
    database.favorites.push({ userId: member.id, characterId: "theron" });
    database.cartItems.push({ userId: member.id, characterId: "theron" });

    const revoked = await revokeMember(member.id, database);
    expect(revoked.accessStatus).toBe("REVOKED");
    expect(database.sessions).toHaveLength(0);
    expect(database.favorites).toEqual([{ userId: member.id, characterId: "theron" }]);
    expect(database.cartItems).toEqual([{ userId: member.id, characterId: "theron" }]);
    await expect(revokeMember(member.id, database)).rejects.toMatchObject({ code: "ALREADY_REVOKED" });
  });

  it("reactivates without restoring sessions and keeps collections", async () => {
    const database = fakeDatabase();
    const member = await seedMember(database);
    database.records.get(member.id)!.accessStatus = "REVOKED";
    database.sessions.push({ tokenHash: "stale-token", userId: member.id });
    database.favorites.push({ userId: member.id, characterId: "theron" });

    const active = await reactivateMember(member.id, database);
    expect(active.accessStatus).toBe("ACTIVE");
    expect(database.sessions).toHaveLength(0);
    expect(database.favorites).toHaveLength(1);
    await expect(reactivateMember(member.id, database)).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it("resets a MEMBER password, invalidates every session, and preserves collections", async () => {
    const database = fakeDatabase();
    const oldPassword = "old member password";
    const member = await seedMember(database, oldPassword);
    database.sessions.push({ tokenHash: "token-a", userId: member.id }, { tokenHash: "token-b", userId: member.id });
    database.favorites.push({ userId: member.id, characterId: "theron" });
    database.cartItems.push({ userId: member.id, characterId: "theron" });
    const replacement = "replacement password";

    await resetMemberPassword(member.id, { password: replacement, confirmPassword: replacement }, database);
    const hash = database.records.get(member.id)!.passwordHash;
    await expect(verifyPassword(oldPassword, hash)).resolves.toBe(false);
    await expect(verifyPassword(replacement, hash)).resolves.toBe(true);
    expect(database.sessions).toHaveLength(0);
    expect(database.favorites).toHaveLength(1);
    expect(database.cartItems).toHaveLength(1);
  });

  it("protects the initial administrator from MEMBER lifecycle actions", async () => {
    const database = fakeDatabase();
    await expect(revokeMember("initial-admin", database)).rejects.toMatchObject({ code: "PROTECTED_ADMIN" });
    await expect(reactivateMember("initial-admin", database)).rejects.toMatchObject({ code: "PROTECTED_ADMIN" });
    await expect(resetMemberPassword("initial-admin", { password: "replacement password", confirmPassword: "replacement password" }, database)).rejects.toMatchObject({ code: "PROTECTED_ADMIN" });
  });
});

interface StoredUser extends ManagedUserDto {
  normalizedUsername: string;
  passwordHash: string;
}

interface FakeDatabase {
  records: Map<string, StoredUser>;
  sessions: Array<{ tokenHash: string; userId: string }>;
  favorites: Array<{ userId: string; characterId: string }>;
  cartItems: Array<{ userId: string; characterId: string }>;
  user: {
    findMany(args: unknown): Promise<ManagedUserDto[]>;
    findUnique(args: unknown): Promise<{ id: string; role: ManagedUserRole; accessStatus: ManagedUserAccessStatus } | null>;
    create(args: unknown): Promise<ManagedUserDto>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<ManagedUserDto>;
  };
  userSession: { deleteMany(args: unknown): Promise<{ count: number }> };
  $transaction<T>(operation: (transaction: FakeDatabase) => Promise<T>): Promise<T>;
}

function fakeDatabase() {
  const now = new Date("2026-08-28T05:37:03.021Z");
  const records = new Map<string, StoredUser>([["initial-admin", {
    id: "initial-admin",
    username: "client",
    normalizedUsername: "client",
    displayName: "Client",
    passwordHash: "admin-hash",
    role: "ADMIN",
    accessStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }]]);
  const sessions: Array<{ tokenHash: string; userId: string }> = [];
  const favorites: Array<{ userId: string; characterId: string }> = [];
  const cartItems: Array<{ userId: string; characterId: string }> = [];

  const database: FakeDatabase = {
    records,
    sessions,
    favorites,
    cartItems,
    user: {
      async findMany(argsValue: unknown) {
        const args = argsValue as { where?: { id?: string } };
        return [...records.values()]
          .filter((record) => !args.where?.id || record.id === args.where.id)
          .map(toDto);
      },
      async findUnique(argsValue: unknown) {
        const args = argsValue as { where: { id: string } };
        const record = records.get(args.where.id);
        return record ? { id: record.id, role: record.role, accessStatus: record.accessStatus } : null;
      },
      async create(argsValue: unknown) {
        const args = argsValue as { data: Omit<StoredUser, "createdAt" | "updatedAt"> };
        if ([...records.values()].some(({ normalizedUsername }) => normalizedUsername === args.data.normalizedUsername)) {
          throw { code: "P2002" };
        }
        const record: StoredUser = { ...args.data, createdAt: new Date(now), updatedAt: new Date(now) };
        records.set(record.id, record);
        return toDto(record);
      },
      async updateMany(argsValue: unknown) {
        const args = argsValue as { where: { id: string; role: ManagedUserRole; accessStatus: ManagedUserAccessStatus }; data: { accessStatus: ManagedUserAccessStatus } };
        const record = records.get(args.where.id);
        if (!record || record.role !== args.where.role || record.accessStatus !== args.where.accessStatus) return { count: 0 };
        record.accessStatus = args.data.accessStatus;
        record.updatedAt = new Date(record.updatedAt.getTime() + 1);
        return { count: 1 };
      },
      async update(argsValue: unknown) {
        const args = argsValue as { where: { id: string }; data: { passwordHash: string } };
        const record = records.get(args.where.id)!;
        record.passwordHash = args.data.passwordHash;
        record.updatedAt = new Date(record.updatedAt.getTime() + 1);
        return toDto(record);
      },
    },
    userSession: {
      async deleteMany(argsValue: unknown) {
        const args = argsValue as { where: { userId: string } };
        const original = sessions.length;
        for (let index = sessions.length - 1; index >= 0; index--) {
          if (sessions[index].userId === args.where.userId) sessions.splice(index, 1);
        }
        return { count: original - sessions.length };
      },
    },
    async $transaction<T>(operation: (transaction: FakeDatabase) => Promise<T>): Promise<T> {
      return operation(database);
    },
  };
  return database;
}

async function seedMember(database: ReturnType<typeof fakeDatabase>, password = "member password phrase"): Promise<ManagedUserDto> {
  return createMember({ username: "friend", displayName: "Friend", password, confirmPassword: password }, database);
}

function toDto(record: StoredUser): ManagedUserDto {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    accessStatus: record.accessStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
