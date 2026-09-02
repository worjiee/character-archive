import { describe, expect, it } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "./test-principals";
import { visibleCharacterWhere } from "./authorization";

describe("visibleCharacterWhere", () => {
  it("requires both ACTIVE status and first publication for MEMBER reads", () => {
    expect(visibleCharacterWhere(TEST_MEMBER_PRINCIPAL)).toEqual({
      status: "ACTIVE",
      publishedAt: { not: null },
    });
  });

  it("keeps non-deleted restricted records available to ADMIN review", () => {
    expect(visibleCharacterWhere(TEST_ADMIN_PRINCIPAL)).toEqual({
      status: { not: "DELETED" },
    });
  });
});
