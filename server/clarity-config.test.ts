import { describe, expect, it } from "vitest";
import { normalizeClarityProjectId } from "./auth/service";

describe("Microsoft Clarity project ID validation", () => {
  it("accepts a normal project identifier and trims surrounding whitespace", () => {
    expect(normalizeClarityProjectId("  ab12CD_34-xy  ")).toBe("ab12CD_34-xy");
  });

  it.each(["", "abc", "project id", "<script>alert(1)</script>", "clarity\nheader", "x".repeat(81)])("rejects unsafe or malformed values: %j", value => {
    expect(() => normalizeClarityProjectId(value)).toThrow(/valid Microsoft Clarity project ID/i);
  });
});
