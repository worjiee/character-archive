import { describe, expect, it } from "vitest";
import { relativeActivityLabel } from "./relative-activity";

const NOW = "2026-08-25T12:00:00.000Z";

describe("relativeActivityLabel", () => {
  it("preserves the existing deterministic labels", () => {
    expect(relativeActivityLabel(NOW, NOW)).toBe("Just now");
    expect(relativeActivityLabel("2026-08-25T11:48:00.000Z", NOW)).toBe("12m ago");
    expect(relativeActivityLabel("2026-08-25T10:00:00.000Z", NOW)).toBe("2h ago");
    expect(relativeActivityLabel("2026-08-24T10:00:00.000Z", NOW)).toBe("1d ago");
  });

  it("clamps future activity to Just now using only supplied values", () => {
    expect(relativeActivityLabel("2026-08-25T12:01:00.000Z", NOW)).toBe("Just now");
  });

  it("handles live relative timestamp intervals matching exact specification", () => {
    // timestamp 20 seconds ago -> JUST NOW
    const twentySecAgo = "2026-08-25T11:59:40.000Z";
    expect(relativeActivityLabel(twentySecAgo, NOW)).toBe("Just now");
    expect(relativeActivityLabel(twentySecAgo, NOW).toUpperCase()).toBe("JUST NOW");

    // timestamp 1 minute ago -> 1M AGO
    const oneMinAgo = "2026-08-25T11:59:00.000Z";
    expect(relativeActivityLabel(oneMinAgo, NOW)).toBe("1m ago");
    expect(relativeActivityLabel(oneMinAgo, NOW).toUpperCase()).toBe("1M AGO");

    // timestamp 5 minutes ago -> 5M AGO
    const fiveMinAgo = "2026-08-25T11:55:00.000Z";
    expect(relativeActivityLabel(fiveMinAgo, NOW)).toBe("5m ago");
    expect(relativeActivityLabel(fiveMinAgo, NOW).toUpperCase()).toBe("5M AGO");

    // timestamp 59 minutes ago -> 59M AGO
    const fiftyNineMinAgo = "2026-08-25T11:01:00.000Z";
    expect(relativeActivityLabel(fiftyNineMinAgo, NOW)).toBe("59m ago");
    expect(relativeActivityLabel(fiftyNineMinAgo, NOW).toUpperCase()).toBe("59M AGO");

    // timestamp 60 minutes ago -> 1H AGO
    const sixtyMinAgo = "2026-08-25T11:00:00.000Z";
    expect(relativeActivityLabel(sixtyMinAgo, NOW)).toBe("1h ago");
    expect(relativeActivityLabel(sixtyMinAgo, NOW).toUpperCase()).toBe("1H AGO");

    // older timestamp -> 1D AGO
    const oneDayAgo = "2026-08-24T12:00:00.000Z";
    expect(relativeActivityLabel(oneDayAgo, NOW)).toBe("1d ago");
    expect(relativeActivityLabel(oneDayAgo, NOW).toUpperCase()).toBe("1D AGO");
  });
});
