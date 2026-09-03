import { status } from "@grpc/grpc-js";
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internalError } from "./internal-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("internalError", () => {
  it("keeps the opaque message and INTERNAL code the caller sees", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const exception = internalError(
      new Error("connection refused on 127.0.0.1:5432"),
      "Cost Ledger request could not be completed",
    );

    expect(exception.getError()).toEqual({
      code: status.INTERNAL,
      message: "Cost Ledger request could not be completed",
    });
  });

  it("records the cause so the failure is diagnosable from the server", () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const cause = new Error("connection refused on 127.0.0.1:5432");

    internalError(cause, "Cost Ledger request could not be completed");

    expect(log).toHaveBeenCalledWith(
      "Cost Ledger request could not be completed",
      cause.stack,
    );
  });

  it("records a thrown non-Error, which has no stack to read", () => {
    const log = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    internalError("provider rejected the request", "Embedding could not be completed");

    expect(log).toHaveBeenCalledWith(
      "Embedding could not be completed",
      "provider rejected the request",
    );
  });
});
