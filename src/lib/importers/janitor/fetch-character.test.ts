import { describe, expect, it, vi } from "vitest";
import {
  fetchJanitorCharacter,
  type JanitorFetch,
  type JanitorRetrievalErrorCode,
} from "./fetch-character";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const ENDPOINT = `https://janitorai.com/hampter/characters/${CHARACTER_ID}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetchResponse(response: Response) {
  return vi.fn(async () => response);
}

async function expectRetrievalError(
  promise: Promise<unknown>,
  code: JanitorRetrievalErrorCode,
  status?: number,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "JanitorRetrievalError",
    code,
    ...(status === undefined ? {} : { status }),
  });
}

describe("fetchJanitorCharacter", () => {
  it("fetches and returns a valid raw character response", async () => {
    const source = { id: CHARACTER_ID, name: "Bride", unknown_field: "preserved" };
    const fetchMock = mockFetchResponse(jsonResponse(source));

    await expect(fetchJanitorCharacter(CHARACTER_ID, { fetch: fetchMock })).resolves.toEqual(
      source,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: expect.anything(),
    });
  });

  it("rejects an invalid UUID without making a request", async () => {
    const fetchMock = mockFetchResponse(jsonResponse({}));

    await expectRetrievalError(
      fetchJanitorCharacter("not-a-uuid", { fetch: fetchMock }),
      "INVALID_CHARACTER_ID",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, "NOT_FOUND"],
    [401, "ACCESS_DENIED"],
    [403, "ACCESS_DENIED"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM_ERROR"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const fetchMock = mockFetchResponse(jsonResponse({ message: "error" }, status));

    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, { fetch: fetchMock }),
      code,
      status,
    );
  });

  it("reports a request timeout", async () => {
    const fetchMock: JanitorFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, { fetch: fetchMock, timeoutMs: 1 }),
      "TIMEOUT",
    );
  });

  it("rejects malformed JSON", async () => {
    const response = new Response("{not valid json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, { fetch: mockFetchResponse(response) }),
      "INVALID_RESPONSE",
      200,
    );
  });

  it("rejects non-object JSON", async () => {
    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, { fetch: mockFetchResponse(jsonResponse([])) }),
      "INVALID_RESPONSE",
      200,
    );
  });

  it("rejects a response with a missing ID", async () => {
    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, {
        fetch: mockFetchResponse(jsonResponse({ name: "Bride" })),
      }),
      "INVALID_RESPONSE",
      200,
    );
  });

  it("rejects a response with a missing name", async () => {
    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, {
        fetch: mockFetchResponse(jsonResponse({ id: CHARACTER_ID })),
      }),
      "INVALID_RESPONSE",
      200,
    );
  });

  it("rejects a response whose ID differs from the requested ID", async () => {
    const differentId = "65a62bc8-392b-4875-9d65-b7dc8501c233";

    await expectRetrievalError(
      fetchJanitorCharacter(CHARACTER_ID, {
        fetch: mockFetchResponse(jsonResponse({ id: differentId, name: "Bride" })),
      }),
      "SOURCE_ID_MISMATCH",
      200,
    );
  });
});
