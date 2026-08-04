import { describe, expect, it, vi } from "vitest";
import type { ActorContextType } from "../../rbac";
import type { WhatsappService } from "./whatsapp.service";
import { WhatsappController } from "./whatsapp.controller";

const actor: ActorContextType = {
  user_id: "usr_1", tenant_id: "ten_1", workspace_id: "ws_1", session_id: "session_1",
  auth_time: 1, roles: ["admin"], permissions: ["integrations:read", "integrations:write"],
};
const account = { id: "wac_1", workspaceId: "ws_1", phoneNumberId: "phone_1", wabaId: "waba_1", accessTokenRef: "secret://token", status: "connected" as const, escalationRules: [{ id: "wer_1", target: "on-call" }] };

describe("WhatsappController", () => {
  it("routes all account-management actions through the service with actor context", async () => {
    const service = {
      register: vi.fn().mockResolvedValue(account), list: vi.fn().mockResolvedValue([account]),
      templates: vi.fn().mockResolvedValue([]), testSend: vi.fn().mockResolvedValue({ messageId: "wamid.1" }),
      health: vi.fn().mockResolvedValue({ status: "healthy" }), updateConfiguration: vi.fn().mockResolvedValue(account),
    } as unknown as WhatsappService;
    const controller = new WhatsappController(service);
    const input = { workspaceId: "ws_1", phoneNumberId: "phone_1", wabaId: "waba_1", accessTokenRef: "secret://token" };

    await expect(controller.register(input, actor, undefined, "idem_1")).resolves.toEqual(account);
    await expect(controller.list(actor, undefined)).resolves.toEqual([account]);
    await expect(controller.templates(account.id, actor, undefined)).resolves.toEqual([]);
    await expect(controller.testSend(account.id, { to: "15551234567", templateName: "hello" }, actor, undefined)).resolves.toEqual({ messageId: "wamid.1" });
    await expect(controller.health(account.id, actor, undefined)).resolves.toEqual({ status: "healthy" });
    await expect(controller.monitoring(account.id, { enabled: true }, actor, undefined, "idem_2")).resolves.toEqual(account);
    await expect(controller.media(account.id, { maxBytes: 10 }, actor, undefined, "idem_3")).resolves.toEqual(account);
    await expect(controller.escalations(account.id, actor, undefined)).resolves.toEqual(account.escalationRules);
    await controller.createEscalation(account.id, { target: "manager" }, actor, undefined, "idem_4");
    await controller.updateEscalation(account.id, "wer_1", { target: "backup" }, actor, undefined, "idem_5");
    await controller.deleteEscalation(account.id, "wer_1", actor, undefined, "idem_6");

    expect(service.updateConfiguration).toHaveBeenCalledWith(account.id, { monitoringConfig: { enabled: true } }, expect.objectContaining({ workspaceId: "ws_1" }), "idem_2");
    expect(service.updateConfiguration).toHaveBeenCalledWith(account.id, { mediaConfig: { maxBytes: 10 } }, expect.anything(), "idem_3");
    expect(service.updateConfiguration).toHaveBeenCalledTimes(5);
  });

  it("rejects a missing authenticated actor or workspace", () => {
    const controller = new WhatsappController({} as WhatsappService);
    const tenantOnlyActor: ActorContextType = {
      user_id: actor.user_id, tenant_id: actor.tenant_id,
      session_id: actor.session_id, auth_time: 1,
      roles: actor.roles, permissions: actor.permissions,
    };
    expect(() => controller.list(undefined, undefined)).toThrow("Authenticated actor required");
    expect(() => controller.list(tenantOnlyActor, undefined)).toThrow("Workspace actor context required");
  });
});
