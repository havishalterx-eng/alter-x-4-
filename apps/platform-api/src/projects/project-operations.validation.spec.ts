import { describe, expect, it } from "vitest";
import {
  parseConversationId,
  parseDeploymentId,
  parseProjectActionInput,
  parseProjectPagination,
} from "./project-operations.validation";

const instance = "/api/v1/projects/example/actions/deploy";
const deploymentId = "dep_018f47a5-7b2c-7d10-8f11-123456789abc";
const conversationId = "cnv_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("project operations validation", () => {
  it("preserves opaque JSON action input", () => {
    const input = {
      target: "production",
      routing: { recommendation: "edge-eu", confidence: 0.91 },
    };
    expect(parseProjectActionInput(input, instance)).toEqual(input);
    expect(parseProjectActionInput(undefined, instance)).toEqual({});
  });

  it.each([null, [], "deploy", 1])(
    "rejects non-object action input %j",
    (input) => {
      expect(() => parseProjectActionInput(input, instance)).toThrowError(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({
            error_code: "PROJECT_VALIDATION_FAILED",
          }),
        }),
      );
    },
  );

  it("parses bounded pagination without inventing defaults", () => {
    expect(parseProjectPagination("next page", "200", instance)).toEqual({
      cursor: "next page",
      limit: 200,
    });
    expect(parseProjectPagination(undefined, undefined, instance)).toEqual({
      cursor: undefined,
      limit: undefined,
    });
  });

  it.each([
    ["", undefined],
    [undefined, "0"],
    [undefined, "201"],
    [undefined, "1.5"],
    [undefined, "bad"],
  ])("rejects invalid pagination", (cursor, limit) => {
    expect(() =>
      parseProjectPagination(cursor, limit, instance),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("validates deployment and conversation prefixes", () => {
    expect(parseDeploymentId(deploymentId, instance)).toBe(deploymentId);
    expect(parseConversationId(conversationId, instance)).toBe(conversationId);

    expect(() => parseDeploymentId(conversationId, instance)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => parseConversationId(deploymentId, instance)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});
