import { describe, expect, it } from "vitest";
import {
  developmentImportUnavailableResponse,
  isDevelopmentFixtureEnabled,
  LIVE_IMPORT_UNAVAILABLE_MESSAGE,
} from "./availability";

describe("development fixture availability", () => {
  it("enables fixtures outside production", () => {
    expect(isDevelopmentFixtureEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDevelopmentFixtureEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("disables fixtures in staging and production builds", () => {
    expect(isDevelopmentFixtureEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(LIVE_IMPORT_UNAVAILABLE_MESSAGE).toBe(
      "Live source importing is currently under development.",
    );
  });

  it("returns a clear non-500 response when live importing is unavailable", async () => {
    const response = developmentImportUnavailableResponse();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "IMPORT_UNAVAILABLE",
        message: LIVE_IMPORT_UNAVAILABLE_MESSAGE,
      },
    });
  });
});
