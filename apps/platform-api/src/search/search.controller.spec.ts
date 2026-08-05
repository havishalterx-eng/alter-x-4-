import { describe, expect, it, vi } from "vitest";
import type { ActorContextType } from "../rbac";
import { SearchController } from "./search.controller";

const actor: ActorContextType = { user_id: "usr_1", tenant_id: "tenant-a", workspace_id: "workspace-a", roles: ["viewer"], permissions: [], session_id: "ses_1" };

describe("SearchController", () => {
  it("passes a validated catalog query and actor tenancy to the service", () => {
    const service = { search: vi.fn().mockResolvedValue({ data: [], page: { has_more: false, next_cursor: null, limit: 50 } }) };
    const controller = new SearchController(service as never);
    void controller.list({ q: "deploy", kind: "tool" }, actor);
    expect(service.search).toHaveBeenCalledWith("tenant-a", { q: "deploy", kind: "tool", limit: 50 });
  });
  it("rejects an empty query before reaching the repository", () => {
    const service = { search: vi.fn() };
    expect(() => new SearchController(service as never).list({ q: " " }, actor)).toThrowError(expect.objectContaining({ status: 400 }));
    expect(service.search).not.toHaveBeenCalled();
  });
});
