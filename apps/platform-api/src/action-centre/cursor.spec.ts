import { describe, expect, it } from "vitest";
import {
  advanceBatch,
  advanceWithinBatch,
  decodeCursor,
  encodeCursor,
  initialCursor,
} from "./cursor";

describe("action centre cursor", () => {
  it("round-trips source cursors, filters, and within-batch offset", () => {
    const initial = initialCursor({
      limit: 10,
      type: "approval",
      status: "pending",
    });
    const advanced = advanceWithinBatch(
      advanceBatch(
        initial,
        { next_cursor: "approval-next", has_more: true },
        undefined,
      ),
      7,
    );
    const encoded = encodeCursor(advanced);
    expect(
      decodeCursor(
        encoded,
        {},
        "/queue",
      ),
    ).toEqual(advanced);
  });

  it("marks exhausted sources while retaining an omitted source", () => {
    const initial = initialCursor({});
    const advanced = advanceBatch(
      initial,
      { next_cursor: null, has_more: false },
      { next_cursor: "esc-next", has_more: true },
    );
    expect(advanced).toMatchObject({
      approval_done: true,
      escalation_done: false,
      approval_cursor: null,
      escalation_cursor: "esc-next",
      offset: 0,
    });
  });

  it.each([
    "not-base64-json",
    Buffer.from("{}").toString("base64url"),
    encodeCursor(initialCursor({ limit: 20 })),
  ])("rejects invalid or query-mismatched cursor", (cursor) => {
    expect(() =>
      decodeCursor(cursor, { limit: 10 }, "/queue"),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
