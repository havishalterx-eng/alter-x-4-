import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { workspaceRolesMetadataKey } from "../rbac/rbac.metadata";
import { OnboardingController } from "./onboarding.controller";

describe("onboarding route RBAC", () => {
  it("allows every workspace member role", () => {
    expect(
      Reflect.getMetadata(workspaceRolesMetadataKey, OnboardingController),
    ).toEqual(["admin", "editor", "operator", "approver", "viewer"]);
  });
});
