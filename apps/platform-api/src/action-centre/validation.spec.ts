import { describe, expect, it } from "vitest";
import {
  parseActionBody,
  parseClarificationAssignmentBody,
  parseClarificationId,
  parseQueueQuery,
  parseResourceId,
  parseTraceparent,
} from "./validation";

const id = "apr_018f47a5-7b2c-7d10-8f11-123456789abc";
const clarificationId = "clr_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("action centre validation", () => {
  it("accepts declared queue filters and opaque objects unchanged", () => {
    expect(
      parseQueueQuery(
        { limit: "25", type: "approval", status: "pending" },
        "/queue",
      ),
    ).toEqual({ limit: 25, type: "approval", status: "pending" });
    expect(parseQueueQuery({ status: "approved" }, "/queue")).toEqual({
      status: "approved",
    });
    expect(parseQueueQuery({ type: "clarification" }, "/queue")).toEqual({
      type: "clarification",
    });
    const body = { answer: " Keep whitespace \n", extension: { value: 1 } };
    expect(parseActionBody(body, "/action")).toBe(body);
    expect(parseResourceId(id, "approvalId", "/action")).toBe(id);
    expect(parseClarificationId(clarificationId, "/action")).toBe(
      clarificationId,
    );
  });

  it.each([
    [{ mode: "workflow" }],
    [{ limit: 0 }],
    [{ status: "resolved" }],
    [{ type: "escalation", status: "pending" }],
    [{ type: "clarification", status: "pending" }],
  ])("rejects invalid queue query %j", (query) => {
    expect(() => parseQueueQuery(query, "/queue")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it.each([null, [], "answer", 42])("rejects non-object body %j", (body) => {
    expect(() => parseActionBody(body, "/action")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("accepts valid clarification assignment and rejects malformed assignees", () => {
    expect(
      parseClarificationAssignmentBody(
        { assignee_user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc" },
        "/assign",
      ),
    ).toEqual({
      assignee_user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
    });
    expect(
      parseClarificationAssignmentBody({ assignee_user_id: null }, "/assign"),
    ).toEqual({ assignee_user_id: null });
    expect(() =>
      parseClarificationAssignmentBody({ assignee_user_id: "user-1" }, "/assign"),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects malformed ids and trace context", () => {
    expect(() => parseResourceId("bad", "approvalId", "/action")).toThrow();
    expect(() => parseClarificationId(id, "/action")).toThrow();
    expect(() => parseTraceparent("bad", "/action")).toThrow();
    expect(parseTraceparent(undefined, "/action")).toBeUndefined();
    expect(
      parseTraceparent(
        "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        "/action",
      ),
    ).toContain("00-");
  });
});
