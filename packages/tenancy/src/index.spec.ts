import { describe, expect, it } from "vitest";
import { fromPrefixedId, toPrefixedId } from "./ids";

describe("@alterx/tenancy", () => {
  it("loads the package scaffold", () => {
    expect(true).toBe(true);
  });

  it("formats API/log boundary ids with prefixes", () => {
    const id = "00000000-0000-7000-8000-000000000001";

    expect(toPrefixedId("ten", id)).toBe(`ten_${id}`);
    expect(fromPrefixedId("usr", `usr_${id}`)).toBe(id);
  });

  it("rejects malformed prefixed ids", () => {
    const id = "00000000-0000-7000-8000-000000000001";

    expect(() => fromPrefixedId("ws", `ten_${id}`)).toThrow("Expected ws_ id");
    expect(() => toPrefixedId("ten", "not-a-uuid")).toThrow(
      "Invalid UUID for ten id",
    );
  });
});
