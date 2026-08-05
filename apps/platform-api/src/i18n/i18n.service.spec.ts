import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { I18nService } from "./i18n.service";

const actor: ActorContext = {
  user_id: "00000000-0000-7000-8000-000000000011",
  tenant_id: "00000000-0000-7000-8000-000000000001",
  workspace_id: "00000000-0000-7000-8000-000000000021",
  roles: ["admin"],
  permissions: [],
  session_id: "session-i18n",
};

describe("I18nService", () => {
  it("returns seeded bundle-shaped content and caches it briefly", async () => {
    const queryTenant = vi.fn().mockResolvedValue([
      { key: "language.english", value: "English" },
      { key: "language.hindi", value: "Hindi" },
    ]);
    const service = new I18nService({ queryTenant } as unknown as PlatformDb);

    await expect(service.getBundle("en", "ui", actor.tenant_id)).resolves.toEqual({
      locale: "en",
      namespace: "ui",
      messages: {
        "language.english": "English",
        "language.hindi": "Hindi",
      },
    });
    await service.getBundle("en", "ui", actor.tenant_id);
    expect(queryTenant).toHaveBeenCalledOnce();
  });

  it("rejects a bundle that has no seeded messages", async () => {
    const service = new I18nService({ queryTenant: vi.fn().mockResolvedValue([]) } as unknown as PlatformDb);

    await expect(service.getBundle("en", "missing", actor.tenant_id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("uses the explicit user preference before the workspace preference", async () => {
    const queryTenant = vi.fn().mockResolvedValue([{ language: "hi" }]);
    const service = new I18nService({ queryTenant } as unknown as PlatformDb);

    await expect(
      service.resolveLocale(actor.user_id, actor.workspace_id, actor.tenant_id),
    ).resolves.toBe("hi");
    expect(queryTenant).toHaveBeenCalledOnce();
  });

  it("uses the workspace default when the user has no preference", async () => {
    const queryTenant = vi
      .fn()
      .mockResolvedValueOnce([{ language: null }])
      .mockResolvedValueOnce([{ language: "hi" }]);
    const service = new I18nService({ queryTenant } as unknown as PlatformDb);

    await expect(
      service.resolveLocale(actor.user_id, actor.workspace_id, actor.tenant_id),
    ).resolves.toBe("hi");
    expect(queryTenant).toHaveBeenCalledTimes(2);
  });

  it("falls back to English when no preference exists", async () => {
    const queryTenant = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new I18nService({ queryTenant } as unknown as PlatformDb);

    await expect(
      service.resolveLocale(actor.user_id, actor.workspace_id, actor.tenant_id),
    ).resolves.toBe("en");
  });

  it("updates only the actor's own preference and the active admin workspace", async () => {
    const queryTenant = vi.fn().mockResolvedValue([{ language: "hi" }]);
    const service = new I18nService({ queryTenant } as unknown as PlatformDb);

    await expect(service.updateUserLanguage(actor, "hi")).resolves.toEqual({ language: "hi" });
    await expect(
      service.updateWorkspaceLanguage(actor, actor.workspace_id!, "hi"),
    ).resolves.toEqual({ language: "hi" });
    await expect(
      service.updateWorkspaceLanguage(actor, "00000000-0000-7000-8000-000000000022", "hi"),
    ).rejects.toMatchObject({ status: 403 });
    expect(queryTenant.mock.calls[0]?.[2]).toEqual([
      "hi",
      actor.user_id,
      actor.tenant_id,
    ]);
  });
});
