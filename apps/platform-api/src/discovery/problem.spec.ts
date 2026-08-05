import { describe, expect, it } from "vitest";
import { DiscoveryHttpError } from "./problem";

describe("DiscoveryHttpError", () => {
  it("uses standard not-found and conflict problem titles", () => {
    expect(new DiscoveryHttpError(404, "DISCOVERY_RECOMMENDATION_NOT_FOUND", "missing", "/discovery").getResponse()).toMatchObject({ title: "Not Found" });
    expect(new DiscoveryHttpError(409, "DISCOVERY_RECOMMENDATION_ALREADY_DECIDED", "decided", "/discovery").getResponse()).toMatchObject({ title: "Conflict" });
  });
});
