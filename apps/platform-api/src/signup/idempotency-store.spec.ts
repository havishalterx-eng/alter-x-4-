import { describe, expect, it, vi } from "vitest";
import { ProcessLocalSignupIdempotencyStore } from "./idempotency-store";

describe("ProcessLocalSignupIdempotencyStore", () => {
  it("shares concurrent operation and permits retry after failure", async () => {
    const store = new ProcessLocalSignupIdempotencyStore();
    let release!: (value: string) => void;
    const operation = vi.fn(
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    const first = store.execute("key", { value: 1 }, operation);
    const second = store.execute("key", { value: 1 }, operation);
    release("done");
    await expect(Promise.all([first, second])).resolves.toEqual(["done", "done"]);
    expect(operation).toHaveBeenCalledOnce();

    const failure = vi.fn().mockRejectedValue(new Error("failed"));
    await expect(store.execute("retry", {}, failure)).rejects.toThrow("failed");
    await expect(store.execute("retry", {}, async () => "retried")).resolves.toBe(
      "retried",
    );
  });

  it("requires key", async () => {
    await expect(
      new ProcessLocalSignupIdempotencyStore().execute("", {}, async () => "no"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
