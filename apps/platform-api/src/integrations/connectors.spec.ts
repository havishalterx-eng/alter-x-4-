import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG, findConnector, isConnectorId } from "./connectors";

describe("connector catalog", () => {
  it("declares exactly the locked launch subset: github and google", () => {
    expect(CONNECTOR_CATALOG.map((c) => c.id).sort()).toEqual([
      "github",
      "google",
    ]);
  });

  it("finds a connector by id and rejects unknown ids", () => {
    expect(findConnector("github")?.displayName).toBe("GitHub");
    expect(findConnector("slack")).toBeUndefined();
    expect(isConnectorId("google")).toBe(true);
    expect(isConnectorId("slack")).toBe(false);
  });

  it("marks PKCE correctly per connector", () => {
    expect(findConnector("github")?.pkce).toBe(false);
    expect(findConnector("google")?.pkce).toBe(true);
  });
});
