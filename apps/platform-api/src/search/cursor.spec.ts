import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSearchCursor, encodeSearchCursor } from "./cursor";
const query = { q: "deploy", kind: "listing" as const, limit: 50 };
describe("search cursor", () => {
  beforeEach(() => {
    vi.stubEnv("MARKETPLACE_SEARCH_CURSOR_SECRET", "test-search-cursor-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a signed, query-bound result position", () => {
    const cursor = encodeSearchCursor(query, { rank: 3.5, id: "lst_1", kind: "listing" });
    expect(decodeSearchCursor(cursor, query, "/api/v1/search")).toMatchObject({ rank: 3.5, id: "lst_1", resultKind: "listing" });
  });
  it("rejects tampering and filter changes", () => {
    const cursor = encodeSearchCursor(query, { rank: 3.5, id: "lst_1", kind: "listing" });
    expect(() => decodeSearchCursor(`${cursor}x`, query, "/api/v1/search")).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => decodeSearchCursor(cursor, { ...query, q: "agent" }, "/api/v1/search")).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects signing when the required secret is absent", () => {
    vi.stubEnv("MARKETPLACE_SEARCH_CURSOR_SECRET", "");
    expect(() => encodeSearchCursor(query, { rank: 3.5, id: "lst_1", kind: "listing" })).toThrow(
      "MARKETPLACE_SEARCH_CURSOR_SECRET is required",
    );
  });
});
