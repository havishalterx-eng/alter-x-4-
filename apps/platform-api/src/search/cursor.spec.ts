import { describe, expect, it } from "vitest";
import { decodeSearchCursor, encodeSearchCursor } from "./cursor";
const query = { q: "deploy", kind: "listing" as const, limit: 50 };
describe("search cursor", () => {
  it("round-trips a signed, query-bound result position", () => {
    const cursor = encodeSearchCursor(query, { rank: 3.5, id: "lst_1", kind: "listing" });
    expect(decodeSearchCursor(cursor, query, "/api/v1/search")).toMatchObject({ rank: 3.5, id: "lst_1", resultKind: "listing" });
  });
  it("rejects tampering and filter changes", () => {
    const cursor = encodeSearchCursor(query, { rank: 3.5, id: "lst_1", kind: "listing" });
    expect(() => decodeSearchCursor(`${cursor}x`, query, "/api/v1/search")).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => decodeSearchCursor(cursor, { ...query, q: "agent" }, "/api/v1/search")).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
