import { describe, expect, it } from "vitest";

import { RecoveryActionIdSchema } from "@alterx/contracts";
import { createRecoveryActionId } from "./recovery-action-id";

describe("createRecoveryActionId", () => {
  it("creates a real rec_ prefixed UUIDv7", () => {
    const id = createRecoveryActionId(1_718_000_000_000);
    expect(RecoveryActionIdSchema.safeParse(id).success).toBe(true);
    expect(id.slice("rec_".length, "rec_".length + 13)).toBe(
      "019000c7-9c00",
    );
  });

  it("rejects timestamps outside the UUIDv7 48-bit field", () => {
    expect(() => createRecoveryActionId(-1)).toThrow(RangeError);
    expect(() => createRecoveryActionId(0x1_0000_0000_0000)).toThrow(
      RangeError,
    );
  });
});
