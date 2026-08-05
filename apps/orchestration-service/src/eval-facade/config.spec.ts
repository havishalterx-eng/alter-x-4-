import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadEvalFacadeEnvironment } from "./config";

const TOKEN_HASH = createHash("sha256").update("test-token").digest("hex");

describe("loadEvalFacadeEnvironment", () => {
  it("loads the internal target and fingerprint", () => {
    expect(loadEvalFacadeEnvironment({
      EVAL_SERVICE_GRPC_TARGET: "eval-service:50062",
      EVAL_FACADE_TOKEN_SHA256: TOKEN_HASH,
    })).toEqual({ grpcTarget: "eval-service:50062", tokenHash: TOKEN_HASH });
  });

  it("fails closed on missing target or invalid fingerprint", () => {
    expect(() => loadEvalFacadeEnvironment({ EVAL_FACADE_TOKEN_SHA256: TOKEN_HASH }))
      .toThrow("EVAL_SERVICE_GRPC_TARGET is required");
    expect(() => loadEvalFacadeEnvironment({ EVAL_SERVICE_GRPC_TARGET: "eval-service:50062" }))
      .toThrow("EVAL_FACADE_TOKEN_SHA256 must be a 64-character SHA-256 fingerprint");
  });
});
