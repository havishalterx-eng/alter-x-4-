import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./validation";

describe("parseSearchQuery", () => {
  it("accepts catalog filters and caps pagination", () => {
    expect(parseSearchQuery({ q: "  deploy  ", kind: "listing", type: "agent", limit: "500" }, "/api/v1/search")).toEqual({ q: "deploy", kind: "listing", type: "agent", limit: 200 });
  });
  it.each([{ q: "" }, { q: "tool", type: "agent" }, { q: "tool", kind: "tool", type: "agent" }])("rejects invalid public search requests", (query) => {
    expect(() => parseSearchQuery(query, "/api/v1/search")).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
