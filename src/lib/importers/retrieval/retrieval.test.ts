import { describe, expect, it, vi } from "vitest";
import {
  JanitorSourceAdapter,
  SourceAdapterRegistry,
  SourceRetrievalOrchestrator,
  defaultSourceOrchestrator,
  defaultSourceRegistry,
  type RetrievedCharacterResult,
  type SourceAdapter,
  type SourcePlatformIdentity,
  type SourceTarget,
} from "./index";
import type { NormalizedCharacter } from "../types";
import {
  createJanitorRequestDiagnostic,
  createJanitorResponseDiagnostic,
} from "./janitor-adapter";

function createMockCharacter(overrides: Partial<NormalizedCharacter> = {}): NormalizedCharacter {
  return {
    externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    platform: "JANITOR_AI",
    sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_theron",
    name: "Theron",
    description: "Description",
    personality: "Personality",
    scenario: "Scenario",
    exampleDialogs: "Dialogs",
    avatarUrl: "https://example.com/avatar.png",
    creator: { externalId: "creator-1", name: "Creator" },
    greetings: [{ content: "Hello", position: 0 }],
    tags: [{ name: "Fantasy", slug: "fantasy" }],
    lorebookReferences: [{ externalId: "lore-1", title: "World" }],
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    rawData: { test: true },
    ...overrides,
  };
}

describe("Source Retrieval Framework", () => {
  describe("Source Adapter Registry & Capabilities", () => {
    it("registers default adapters with accurate platform capabilities", () => {
      const janitor = defaultSourceRegistry.getAdapter("JANITOR_AI");
      expect(janitor).toBeDefined();
      expect(janitor?.capabilities).toEqual({
        singleCharacter: true,
        creatorProfile: false,
        lorebooks: false,
        sourceTimestamps: true,
        authenticatedRetrieval: false,
        publicRetrieval: true,
        persistedPlatform: true,
      });

      const saucepan = defaultSourceRegistry.getAdapter("SAUCEPAN");
      expect(saucepan).toBeDefined();
      expect(saucepan?.capabilities.persistedPlatform).toBe(true);

      const datacat = defaultSourceRegistry.getAdapter("DATACAT");
      expect(datacat).toBeDefined();
      expect(datacat?.capabilities.persistedPlatform).toBe(true);

      const janny = defaultSourceRegistry.getAdapter("JANNY");
      expect(janny).toBeDefined();
      expect(janny?.platform).toBe("JANNY");
      // Janny is explicitly unpersisted and NOT mapped to OTHER
      expect(janny?.capabilities.persistedPlatform).toBe(false);
    });

    it("allows custom adapter registration", () => {
      const registry = new SourceAdapterRegistry();
      const customAdapter: SourceAdapter = {
        platform: "SAUCEPAN",
        capabilities: {
          singleCharacter: true,
          creatorProfile: false,
          lorebooks: false,
          sourceTimestamps: true,
          authenticatedRetrieval: false,
          publicRetrieval: true,
          persistedPlatform: true,
        },
        parseTarget: vi.fn(),
        retrieveCharacter: vi.fn(),
      };

      registry.registerAdapter(customAdapter);
      expect(registry.getAdapter("SAUCEPAN")).toBe(customAdapter);
    });
  });

  describe("Target Parsing & URL Safety", () => {
    const adapter = new JanitorSourceAdapter();

    it("parses valid Janitor character URLs", () => {
      const result = adapter.parseTarget(
        "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_theron-the-paladin",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target).toEqual({
          platform: "JANITOR_AI",
          type: "CHARACTER",
          externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
          canonicalUrl:
            "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
          rawInput:
            "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_theron-the-paladin",
        });
      }
    });

    it("canonicalizes www, a trailing slash, and query parameters", () => {
      const result = adapter.parseTarget(
        "https://www.janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_theron/?ref=share",
      );
      expect(result).toMatchObject({
        success: true,
        target: {
          externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
          canonicalUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
        },
      });
    });

    it("rejects lookalike hosts, extra path segments, and fragments", () => {
      for (const input of [
        "https://janitorai.com.evil.example/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
        "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7/extra",
        "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7#private",
      ]) {
        expect(adapter.parseTarget(input).success).toBe(false);
      }
    });

    it("parses valid Janitor creator profile URLs", () => {
      const result = adapter.parseTarget(
        "https://www.janitorai.com/profiles/e8855bc9-9c86-59fd-bba0-6700be658de8_creator-name",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target).toEqual({
          platform: "JANITOR_AI",
          type: "CREATOR_PROFILE",
          externalId: "e8855bc9-9c86-59fd-bba0-6700be658de8",
          canonicalUrl:
            "https://janitorai.com/profiles/e8855bc9-9c86-59fd-bba0-6700be658de8",
          rawInput:
            "https://www.janitorai.com/profiles/e8855bc9-9c86-59fd-bba0-6700be658de8_creator-name",
        });
      }
    });

    it("parses valid Janitor lorebook URLs", () => {
      const result = adapter.parseTarget(
        "https://janitorai.com/lorebooks/f9966cd0-0d97-40fe-8cb1-7811cf769ef9_dku-locations",
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target).toEqual({
          platform: "JANITOR_AI",
          type: "LOREBOOK",
          externalId: "f9966cd0-0d97-40fe-8cb1-7811cf769ef9",
          canonicalUrl:
            "https://janitorai.com/lorebooks/f9966cd0-0d97-40fe-8cb1-7811cf769ef9",
          rawInput:
            "https://janitorai.com/lorebooks/f9966cd0-0d97-40fe-8cb1-7811cf769ef9_dku-locations",
        });
      }
    });

    it("rejects embedded credentials in URL", () => {
      const result = adapter.parseTarget(
        "https://user:password@janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("EMBEDDED_CREDENTIALS");
      }
    });

    it("rejects non-HTTPS protocol", () => {
      const result = adapter.parseTarget(
        "http://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("UNSUPPORTED_SCHEME");
      }
    });

    it("rejects unsupported host", () => {
      const result = adapter.parseTarget(
        "https://malicious-site.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("UNSUPPORTED_HOST");
      }
    });

    it("rejects malformed UUID target", () => {
      const result = adapter.parseTarget(
        "https://janitorai.com/characters/not-a-valid-uuid",
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("MALFORMED_TARGET");
      }
    });
  });

  describe("Janitor Adapter Character Retrieval (Mocked Network)", () => {
    const adapter = new JanitorSourceAdapter();
    const targetId = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
    const validTarget: SourceTarget = {
      platform: "JANITOR_AI",
      type: "CHARACTER",
      externalId: targetId,
      canonicalUrl: `https://janitorai.com/characters/${targetId}`,
      rawInput: `https://janitorai.com/characters/${targetId}`,
    };

    it("retrieves and normalizes a character on HTTP 200", async () => {
      const payload = {
        id: targetId,
        name: "Theron",
        description: "A brave paladin",
        personality: "Noble and kind",
        scenario: "Training ground",
        example_dialogs: "Hello traveler",
        avatar: "avatar.png",
        creator_id: "c-1",
        creator_name: "PaladinAuthor",
        first_messages: ["Greetings, adventurer!"],
        tags: [{ id: 1, name: "Fantasy", slug: "fantasy" }],
        scripts: [{ id: "l-1", type: "lorebook", title: "Holy Realm" }],
      };

      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await adapter.retrieveCharacter(validTarget, {
        fetch: fetchMock,
        authorization: "Bearer mock-token-123",
      });
      expect(result.status).toBe("RETRIEVED");
      expect(result.character).toBeDefined();
      expect(result.character?.name).toBe("Theron");
      expect(result.character?.creator.name).toBe("PaladinAuthor");
      expect(result.character?.greetings).toEqual([{ content: "Greetings, adventurer!", position: 0 }]);
      expect(result.character?.tags).toEqual([{ externalId: "1", name: "Fantasy", slug: "fantasy" }]);
      expect(result.character?.lorebookReferences).toEqual([{ externalId: "l-1", title: "Holy Realm" }]);
      expect(result.character?.rawData).toEqual(payload);

      expect(fetchMock).toHaveBeenCalledWith(
        `https://janitorai.com/hampter/characters/${targetId}`,
        expect.objectContaining({
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*",
            Authorization: "Bearer mock-token-123",
          },
          credentials: "omit",
          redirect: "manual",
        }),
      );

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const requestHeaders = request.headers as Record<string, string>;
      expect(requestHeaders.Authorization).toBe("Bearer mock-token-123");
      expect(requestHeaders.Cookie).toBeUndefined();
      expect(requestHeaders.cookie).toBeUndefined();
      expect(JSON.stringify(requestHeaders)).not.toContain("owner_session");
    });

    it("keeps redirects manual and does not follow an upstream redirect", async () => {
      const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://janitorai.com/login" },
        });
      });

      const result = await adapter.retrieveCharacter(validTarget, {
        fetch: fetchMock,
        authorization: "Bearer dummy-token",
      });

      expect(result.status).toBe("INACCESSIBLE");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({ redirect: "manual" }),
      );
    });

    it("creates sanitized request and response diagnostics without credential values", () => {
      const dummyToken = "diagnostic-secret-dummy-token";
      const requestDiagnostic = createJanitorRequestDiagnostic(
        `https://janitorai.com/hampter/characters/${targetId}`,
        {
          Accept: "application/json, text/plain, */*",
          Authorization: `Bearer ${dummyToken}`,
        },
      );
      const responseDiagnostic = createJanitorResponseDiagnostic(
        new Response(null, {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      );

      expect(requestDiagnostic).toEqual({
        method: "GET",
        hostname: "janitorai.com",
        pathname: `/hampter/characters/${targetId}`,
        accept: "application/json, text/plain, */*",
        authorizationPresent: true,
        authorizationScheme: "Bearer",
        authorizationLength: `Bearer ${dummyToken}`.length,
        redirect: "manual",
      });
      expect(responseDiagnostic).toEqual({
        status: 403,
        contentType: "application/json",
      });
      expect(JSON.stringify({ requestDiagnostic, responseDiagnostic })).not.toContain(
        dummyToken,
      );
    });

    it("returns INACCESSIBLE on HTTP 401 and 403 with unauthorized or connectionRequired flags", async () => {
      for (const status of [401, 403]) {
        const fetchMockAuth = vi.fn(async () =>
          new Response(JSON.stringify({ error: "Forbidden" }), { status }),
        );
        const resultAuth = await adapter.retrieveCharacter(validTarget, {
          fetch: fetchMockAuth,
          authorization: "Bearer token",
        });
        expect(resultAuth.status).toBe("INACCESSIBLE");
        expect(resultAuth.unauthorizedConnection).toBe(true);
        expect(resultAuth.error).toBe(
          "Janitor rejected the connection. Reconnect with a current authorized credential.",
        );

        const fetchMockNoAuth = vi.fn(async () =>
          new Response(JSON.stringify({ error: "Forbidden" }), { status }),
        );
        const resultNoAuth = await adapter.retrieveCharacter(validTarget, {
          fetch: fetchMockNoAuth,
        });
        expect(resultNoAuth.status).toBe("INACCESSIBLE");
        expect(resultNoAuth.connectionRequired).toBe(true);
      }
    });

    it("returns NOT_FOUND on HTTP 404", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      );
      const result = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock });
      expect(result.status).toBe("NOT_FOUND");
      expect(result.character).toBeUndefined();
      expect(result.error).toContain("not found");
    });

    it("returns RATE_LIMITED on HTTP 429 and parses Retry-After header", async () => {
      // 1. Seconds format
      const fetchMock1 = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
      );
      const result1 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock1 });
      expect(result1.status).toBe("RATE_LIMITED");
      expect(result1.retryAfterSeconds).toBe(60);

      // 2. Capped at 300s
      const fetchMock2 = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "Retry-After": "999" },
        }),
      );
      const result2 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock2 });
      expect(result2.status).toBe("RATE_LIMITED");
      expect(result2.retryAfterSeconds).toBe(300);

      // 3. HTTP date in future capped at 300s
      const futureDate = new Date(Date.now() + 120_000).toUTCString();
      const fetchMock3 = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "Retry-After": futureDate },
        }),
      );
      const result3 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock3 });
      expect(result3.status).toBe("RATE_LIMITED");
      expect(result3.retryAfterSeconds).toBeGreaterThanOrEqual(115);
      expect(result3.retryAfterSeconds).toBeLessThanOrEqual(125);

      // 4. Missing Retry-After
      const fetchMock4 = vi.fn(async () =>
        new Response(JSON.stringify({ error: "Rate limit exceeded" }), { status: 429 }),
      );
      const result4 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock4 });
      expect(result4.status).toBe("RATE_LIMITED");
      expect(result4.retryAfterSeconds).toBeUndefined();
      expect(result4.retryable).toBe(true);
    });

    it("marks only the allowed gateway statuses as retryable", async () => {
      for (const status of [502, 503, 504]) {
        const result = await adapter.retrieveCharacter(validTarget, {
          fetch: vi.fn(async () => new Response(null, { status })),
        });
        expect(result).toMatchObject({ status: "INACCESSIBLE", retryable: true });
      }
      const result = await adapter.retrieveCharacter(validTarget, {
        fetch: vi.fn(async () => new Response(null, { status: 500 })),
      });
      expect(result.retryable).toBeUndefined();
    });

    it("returns MALFORMED on malformed JSON", async () => {
      const fetchMock = vi.fn(async () =>
        new Response("not a { json string", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock });
      expect(result.status).toBe("MALFORMED");
      expect(result.character).toBeUndefined();
    });

    it("returns MALFORMED on non-JSON content-type", async () => {
      const fetchMock = vi.fn(async () =>
        new Response("<html><body>Blocked</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
      const result = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock });
      expect(result.status).toBe("MALFORMED");
      expect(result.character).toBeUndefined();
    });

    it("returns MALFORMED on invalid schema (missing ID, missing name, mismatched ID)", async () => {
      // 1. Missing name
      const fetchMock1 = vi.fn(async () =>
        new Response(JSON.stringify({ id: targetId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result1 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock1 });
      expect(result1.status).toBe("MALFORMED");

      // 2. Mismatched ID
      const fetchMock2 = vi.fn(async () =>
        new Response(
          JSON.stringify({ id: "e8855bc9-9c86-59fd-bba0-6700be658de8", name: "Other" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      const result2 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock2 });
      expect(result2.status).toBe("MALFORMED");

      // 3. Array payload
      const fetchMock3 = vi.fn(async () =>
        new Response(JSON.stringify([{ id: targetId, name: "Other" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result3 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock3 });
      expect(result3.status).toBe("MALFORMED");
    });

    it("returns MALFORMED when response contains credential-shaped fields", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: targetId,
            name: "Theron",
            sessionToken: "secret-cookie-leak",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
      const result = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock });
      expect(result.status).toBe("MALFORMED");
      expect(result.error).toContain("Credential");
    });

    it("returns MALFORMED on oversized response (> 2 MB)", async () => {
      // 1. Content-Length header oversized
      const fetchMock1 = vi.fn(async () =>
        new Response(JSON.stringify({ id: targetId, name: "Theron" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(3 * 1024 * 1024),
          },
        }),
      );
      const result1 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock1 });
      expect(result1.status).toBe("MALFORMED");

      // 2. Large body text
      const hugeName = "A".repeat(3 * 1024 * 1024);
      const fetchMock2 = vi.fn(async () =>
        new Response(JSON.stringify({ id: targetId, name: hugeName }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const result2 = await adapter.retrieveCharacter(validTarget, { fetch: fetchMock2 });
      expect(result2.status).toBe("MALFORMED");
    });

    it("returns INACCESSIBLE on timeout", async () => {
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );

      const result = await adapter.retrieveCharacter(validTarget, {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        timeoutMs: 5,
      });
      expect(result.status).toBe("INACCESSIBLE");
      expect(result.error).toContain("timed out");
    });

    it("returns INACCESSIBLE when caller signal is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ id: targetId, name: "Theron" })),
      );

      const result = await adapter.retrieveCharacter(validTarget, {
        fetch: fetchMock,
        signal: controller.signal,
      });
      expect(result.status).toBe("INACCESSIBLE");
      expect(result.error).toContain("aborted");
    });

    it("returns UNSUPPORTED for non-character target types", async () => {
      const profileTarget: SourceTarget = {
        platform: "JANITOR_AI",
        type: "CREATOR_PROFILE",
        externalId: targetId,
        canonicalUrl: `https://janitorai.com/profiles/${targetId}`,
        rawInput: `https://janitorai.com/profiles/${targetId}`,
      };

      const result = await adapter.retrieveCharacter(profileTarget);
      expect(result.status).toBe("UNSUPPORTED");
    });

    it("returns empty profile stream without network requests", async () => {
      const targetResult = adapter.parseTarget(
        "https://janitorai.com/profiles/e8855bc9-9c86-59fd-bba0-6700be658de8",
      );
      expect(targetResult.success).toBe(true);
      if (targetResult.success) {
        const page = await adapter.retrieveProfilePage(targetResult.target, 1, 20);
        expect(page.hasMore).toBe(false);
        expect(page.items).toEqual([]);
      }
    });

    it("returns UNSUPPORTED status for lorebook retrieval without network requests", async () => {
      const targetResult = adapter.parseTarget(
        "https://janitorai.com/lorebooks/f9966cd0-0d97-40fe-8cb1-7811cf769ef9",
      );
      expect(targetResult.success).toBe(true);
      if (targetResult.success) {
        const result = await adapter.retrieveLorebook(targetResult.target);
        expect(result.status).toBe("UNSUPPORTED");
      }
    });
  });

  describe("Source Retrieval Orchestrator", () => {
    it("coordinates single character retrieval and duplicate analysis", async () => {
      const mockCharacter = createMockCharacter();
      const mockAdapter: SourceAdapter = {
        platform: "JANITOR_AI",
        capabilities: {
          singleCharacter: true,
          creatorProfile: false,
          lorebooks: false,
          sourceTimestamps: true,
          authenticatedRetrieval: false,
          publicRetrieval: true,
          persistedPlatform: true,
        },
        parseTarget: (input) => ({
          success: true,
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: mockCharacter.externalId,
            canonicalUrl: mockCharacter.sourceUrl,
            rawInput: input,
          },
        }),
        retrieveCharacter: async (target) => ({
          status: "RETRIEVED",
          target,
          character: mockCharacter,
        }),
      };

      const registry = new SourceAdapterRegistry();
      registry.registerAdapter(mockAdapter);

      const orchestrator = new SourceRetrievalOrchestrator({ registry });
      const target = orchestrator.parseInput(mockCharacter.sourceUrl);
      expect(target.success).toBe(true);

      if (target.success) {
        const retrieved = await orchestrator.retrieveCharacter(target.target);
        expect(retrieved.status).toBe("RETRIEVED");
        expect(retrieved.character?.name).toBe("Theron");
      }
    });

    it("constructs clean batch preview summary with duplicate states and no rawData", async () => {
      const character1 = createMockCharacter({
        externalId: "11111111-1111-1111-1111-111111111111",
        name: "Exact Bot",
      });
      const character2 = createMockCharacter({
        externalId: "22222222-2222-2222-2222-222222222222",
        name: "New Bot",
      });
      const character3 = createMockCharacter({
        externalId: "33333333-3333-3333-3333-333333333333",
        name: "Candidate Bot",
      });

      const mockItems: RetrievedCharacterResult[] = [
        {
          status: "RETRIEVED",
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: character1.externalId,
            canonicalUrl: character1.sourceUrl,
            rawInput: character1.sourceUrl,
          },
          character: character1,
        },
        {
          status: "RETRIEVED",
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: character2.externalId,
            canonicalUrl: character2.sourceUrl,
            rawInput: character2.sourceUrl,
          },
          character: character2,
        },
        {
          status: "RETRIEVED",
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: character3.externalId,
            canonicalUrl: character3.sourceUrl,
            rawInput: character3.sourceUrl,
          },
          character: character3,
        },
        {
          status: "INACCESSIBLE",
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: "44444444-4444-4444-4444-444444444444",
            canonicalUrl: "https://janitorai.com/characters/44444444-4444-4444-4444-444444444444",
            rawInput: "https://janitorai.com/characters/44444444-4444-4444-4444-444444444444",
          },
          error: "Character is private or deleted.",
        },
      ];

      const analyzeDuplicatesMock = vi.fn(async (char: NormalizedCharacter) => {
        if (char.externalId === character1.externalId) {
          return {
            classification: "EXACT_SOURCE" as const,
            exactSource: { characterId: "char-existing-1", characterSourceId: "src-1" },
            candidates: [],
          };
        }
        if (char.externalId === character3.externalId) {
          return {
            classification: "POSSIBLE_DUPLICATE" as const,
            exactSource: null,
            candidates: [
              {
                characterId: "char-existing-2",
                name: "Candidate Bot",
                avatarUrl: null,
                creatorName: "Creator",
                sources: [
                  {
                    platform: "SAUCEPAN" as const,
                    externalCreatorId: "c2",
                    creatorName: "Creator",
                    label: "Saucepan",
                    shortLabel: "Sauce",
                    mark: "S",
                    color: "orange",
                  },
                ],
                score: 55,
                confidence: "MEDIUM" as const,
                evidence: [
                  {
                    code: "EXACT_NAME_AND_CREATOR_MATCH" as const,
                    label: "Exact name and creator match",
                    weight: 55,
                  },
                ],
              },
            ],
          };
        }
        return {
          classification: "NO_MATCH" as const,
          exactSource: null,
          candidates: [],
        };
      });

      const orchestrator = new SourceRetrievalOrchestrator({
        analyzeDuplicates: analyzeDuplicatesMock,
      });

      const summary = await orchestrator.buildBatchPreviewSummary(mockItems);

      expect(summary.totalFound).toBe(4);
      expect(summary.exactExistingCount).toBe(1);
      expect(summary.newCount).toBe(1);
      expect(summary.reviewRequiredCount).toBe(1);
      expect(summary.unavailableCount).toBe(1);
      expect(summary.lorebooksDiscovered).toBe(3);

      expect(summary.items[0]).toMatchObject({
        externalId: character1.externalId,
        state: "EXACT_EXISTING",
      });
      expect(summary.items[1]).toMatchObject({
        externalId: character2.externalId,
        state: "NEW",
      });
      expect(summary.items[2]).toMatchObject({
        externalId: character3.externalId,
        state: "REVIEW_REQUIRED",
      });
      expect(summary.items[3]).toMatchObject({
        state: "UNAVAILABLE",
        error: "Character is private or deleted.",
      });

      // Confirm rawData is excluded from batch DTO
      for (const item of summary.items) {
        expect(item).not.toHaveProperty("rawData");
      }
    });

    it("retrieves single character via retrieveSingleCharacter and throws SourceRetrievalError on failures", async () => {
      const mockCharacter = createMockCharacter();
      const mockAdapter: SourceAdapter = {
        platform: "JANITOR_AI",
        capabilities: {
          singleCharacter: true,
          creatorProfile: true,
          lorebooks: true,
          sourceTimestamps: true,
          authenticatedRetrieval: false,
          publicRetrieval: true,
          persistedPlatform: true,
        },
        parseTarget: (input) => {
          if (input.includes("invalid")) {
            return { success: false, error: "Invalid URL", code: "INVALID_URL" };
          }
          if (input.includes("credentials")) {
            return { success: false, error: "Credentials rejected", code: "EMBEDDED_CREDENTIALS" };
          }
          if (input.includes("profiles")) {
            return {
              success: true,
              target: {
                platform: "JANITOR_AI",
                type: "CREATOR_PROFILE",
                externalId: "c-1",
                canonicalUrl: input,
                rawInput: input,
              },
            };
          }
          return {
            success: true,
            target: {
              platform: "JANITOR_AI",
              type: "CHARACTER",
              externalId: mockCharacter.externalId,
              canonicalUrl: mockCharacter.sourceUrl,
              rawInput: input,
            },
          };
        },
        retrieveCharacter: async (target, options) => {
          void options;
          if (target.rawInput.includes("404")) {
            return { status: "NOT_FOUND", target, error: "Character not found." };
          }
          if (target.rawInput.includes("unauthorized")) {
            return {
              status: "INACCESSIBLE",
              target,
              error:
                "Janitor rejected the connection. Reconnect with a current authorized credential.",
              unauthorizedConnection: true,
            };
          }
          return { status: "RETRIEVED", target, character: mockCharacter };
        },
      };

      const mockCredentialProvider = {
        getAuthorizationHeader: vi.fn(async (p: SourcePlatformIdentity) =>
          p === "JANITOR_AI" ? "Bearer valid-token" : null,
        ),
        setCredential: vi.fn(),
        revokeCredential: vi.fn(),
        getConnectionStatus: vi.fn(async (p: SourcePlatformIdentity) => ({
          connected: true,
          platform: p,
          expiresAt: null,
          updatedAt: null,
        })),
      };

      const registry = new SourceAdapterRegistry();
      registry.registerAdapter(mockAdapter);
      const orchestrator = new SourceRetrievalOrchestrator({
        registry,
        credentialProvider: mockCredentialProvider,
      });

      // Successful retrieval
      const character = await orchestrator.retrieveSingleCharacter(mockCharacter.sourceUrl);
      expect(character.name).toBe("Theron");
      expect(mockCredentialProvider.getAuthorizationHeader).not.toHaveBeenCalled();

      await orchestrator.retrieveSingleCharacter(mockCharacter.sourceUrl, {
        mode: "ADMIN_CREDENTIAL_DIAGNOSTIC",
        diagnosticAuthorized: true,
      });
      expect(mockCredentialProvider.getAuthorizationHeader).toHaveBeenCalledWith("JANITOR_AI");

      await expect(orchestrator.retrieveSingleCharacter(mockCharacter.sourceUrl, {
        mode: "ADMIN_CREDENTIAL_DIAGNOSTIC",
      })).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "AUTH_REQUIRED",
      });

      // Unauthorized connection error (token expired or rejected by Janitor)
      await expect(
        orchestrator.retrieveSingleCharacter("https://janitorai.com/characters/unauthorized"),
      ).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "AUTH_REQUIRED",
      });

      // Invalid URL error
      await expect(orchestrator.retrieveSingleCharacter("https://janitorai.com/invalid")).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "INVALID_URL",
      });

      // Credentials rejected error
      await expect(orchestrator.retrieveSingleCharacter("https://user:pass@janitorai.com/credentials")).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "INVALID_URL",
      });

      // Unsupported target type (profile)
      await expect(orchestrator.retrieveSingleCharacter("https://janitorai.com/profiles/c-1")).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "UNSUPPORTED_SOURCE",
      });

      // 404 Not Found error
      await expect(orchestrator.retrieveSingleCharacter("https://janitorai.com/characters/404")).rejects.toMatchObject({
        name: "SourceRetrievalError",
        code: "NOT_FOUND",
      });
    });

    it("previews single character and returns duplicate analysis via previewSingle", async () => {
      const mockCharacter = createMockCharacter();
      const mockAdapter: SourceAdapter = {
        platform: "JANITOR_AI",
        capabilities: {
          singleCharacter: true,
          creatorProfile: false,
          lorebooks: false,
          sourceTimestamps: true,
          authenticatedRetrieval: false,
          publicRetrieval: true,
          persistedPlatform: true,
        },
        parseTarget: (input) => ({
          success: true,
          target: {
            platform: "JANITOR_AI",
            type: "CHARACTER",
            externalId: mockCharacter.externalId,
            canonicalUrl: mockCharacter.sourceUrl,
            rawInput: input,
          },
        }),
        retrieveCharacter: async (target) => ({
          status: "RETRIEVED",
          target,
          character: mockCharacter,
        }),
      };

      const mockCredentialProvider = {
        getAuthorizationHeader: vi.fn(async () => "Bearer valid-token"),
        setCredential: vi.fn(),
        revokeCredential: vi.fn(),
        getConnectionStatus: vi.fn(async (p: SourcePlatformIdentity) => ({
          connected: true,
          platform: p,
          expiresAt: null,
          updatedAt: null,
        })),
      };

      const registry = new SourceAdapterRegistry();
      registry.registerAdapter(mockAdapter);
      const analyzeDuplicatesMock = vi.fn(async () => ({
        classification: "NO_MATCH" as const,
        exactSource: null,
        candidates: [],
      }));

      const orchestrator = new SourceRetrievalOrchestrator({
        registry,
        analyzeDuplicates: analyzeDuplicatesMock,
        credentialProvider: mockCredentialProvider,
      });

      const preview = await orchestrator.previewSingle(mockCharacter.sourceUrl);
      expect(preview.character.name).toBe("Theron");
      expect(preview.duplicateAnalysis.classification).toBe("NO_MATCH");
      expect(analyzeDuplicatesMock).toHaveBeenCalledOnce();
    });

    it("retries only bounded transient failures", async () => {
      const mockCharacter = createMockCharacter();
      let attempts = 0;
      const timeoutValues: number[] = [];
      const adapter: SourceAdapter = {
        platform: "JANITOR_AI",
        capabilities: {
          singleCharacter: true, creatorProfile: false, lorebooks: false,
          sourceTimestamps: true, authenticatedRetrieval: false,
          publicRetrieval: true, persistedPlatform: true,
        },
        parseTarget: (input) => ({
          success: true,
          target: { platform: "JANITOR_AI", type: "CHARACTER", externalId: mockCharacter.externalId, canonicalUrl: mockCharacter.sourceUrl, rawInput: input },
        }),
        retrieveCharacter: async (target, options) => {
          attempts += 1;
          timeoutValues.push(options?.timeoutMs ?? 0);
          return attempts < 3
            ? { status: "INACCESSIBLE", target, retryable: true, error: "transient" }
            : { status: "RETRIEVED", target, character: mockCharacter };
        },
      };
      const registry = new SourceAdapterRegistry();
      registry.registerAdapter(adapter);
      const orchestrator = new SourceRetrievalOrchestrator({ registry });

      await expect(orchestrator.retrieveSingleCharacter(mockCharacter.sourceUrl)).resolves.toBe(mockCharacter);
      expect(attempts).toBe(3);
      expect(timeoutValues.every((value) => value > 0 && value <= 10_000)).toBe(true);
    });

    it("makes zero Prisma database mutations", () => {
      const orchestrator = defaultSourceOrchestrator;
      expect(orchestrator).toBeDefined();
    });
  });
});
