import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
  visibleCharacterWhere: vi.fn(() => ({ status: "ACTIVE", publishedAt: { not: null } })),
}));
const database = vi.hoisted(() => ({ findFirst: vi.fn() }));
const objectStore = vi.hoisted(() => ({ readFinal: vi.fn() }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/lib/prisma", () => ({ prisma: { character: { findFirst: database.findFirst } } }));
vi.mock("@/src/lib/artwork/index", () => ({
  getArtworkObjectStore: () => objectStore,
  artworkResponse: (bytes: Uint8Array, options: { etag: string }) => new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "image/png", ETag: `"${options.etag}"` },
  }),
}));

import { GET } from "./route";

const principal = { userId: "user-a", username: "a", displayName: "A", role: "MEMBER" as const };
const finalBytes = Uint8Array.of(1, 2, 3, 4);
const digest = createHash("sha256").update(finalBytes).digest("hex");

describe("durable Character artwork route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ sessionId: "session-a", principal });
    database.findFirst.mockResolvedValue({
      artwork: { sha256: digest, mediaType: "image/png", byteLength: 4, storageKey: `artwork/sha256/${digest}.png` },
    });
    objectStore.readFinal.mockResolvedValue(finalBytes);
  });

  it("applies the ordinary Character visibility predicate before reading storage", async () => {
    const response = await GET(new Request("http://localhost/api/characters/character-a/artwork"), {
      params: Promise.resolve({ id: "character-a" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(database.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: "character-a" }, { status: "ACTIVE", publishedAt: { not: null } }] },
      select: { artwork: { select: { sha256: true, mediaType: true, byteLength: true, storageKey: true } } },
    });
    expect(auth.visibleCharacterWhere).toHaveBeenCalledWith(principal);
    expect(objectStore.readFinal).toHaveBeenCalledWith(`artwork/sha256/${digest}.png`);
  });

  it("returns not found without reading storage for restricted or unlinked Characters", async () => {
    database.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/characters/restricted/artwork"), {
      params: Promise.resolve({ id: "restricted" }),
    });
    expect(response.status).toBe(404);
    expect(objectStore.readFinal).not.toHaveBeenCalled();
  });

  it("does not serve an object whose byte length disagrees with durable metadata", async () => {
    objectStore.readFinal.mockResolvedValue(Uint8Array.of(1));
    const response = await GET(new Request("http://localhost/api/characters/character-a/artwork"), {
      params: Promise.resolve({ id: "character-a" }),
    });
    expect(response.status).toBe(404);
  });

  it("preserves the shared authentication gate", async () => {
    auth.requireUserApiSession.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/characters/character-a/artwork"), {
      params: Promise.resolve({ id: "character-a" }),
    });
    expect(response.status).toBe(401);
    expect(database.findFirst).not.toHaveBeenCalled();
  });
});
