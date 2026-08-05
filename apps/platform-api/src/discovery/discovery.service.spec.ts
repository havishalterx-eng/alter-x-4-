import { describe, expect, it, vi } from "vitest";
import { DiscoveryService, scoreRecommendations } from "./discovery.service";
import type { DiscoveryRecommendation, DiscoverySignals } from "./types";

const actor = {
  user_id: "usr_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  tenant_id: "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  workspace_id: "018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaab",
  roles: ["editor"],
  permissions: [],
  session_id: "ses_1",
};

const signals: DiscoverySignals = {
  runs: [{ id: "run_1", kind: "completed" }, { id: "run_2", kind: "failed" }],
  adsDocuments: [{ id: "doc_1" }],
  decidedApprovals: [{ id: "apr_1", kind: "approved" }, { id: "apr_2", kind: "rejected" }],
  connectorActivity: [{ id: "act_1", kind: "sync", connector: "github" }],
};

const suggested: DiscoveryRecommendation = {
  id: "rec_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
  tenantId: actor.tenant_id,
  workspaceId: actor.workspace_id,
  problemStatement: "Reduce recurring human approval work in connected workflows",
  evidence: {},
  estimatedValue: 60,
  estimatedEffort: 2,
  requiredIntegrations: ["github"],
  riskLevel: "medium",
  confidence: 0.64,
  status: "suggested",
  createdAt: "2026-08-05T00:00:00.000Z",
};

function serviceForAccept(workflowStatus: string = "draft") {
  const repository = {
    find: vi.fn().mockResolvedValueOnce(suggested).mockResolvedValueOnce({ ...suggested, status: "accepted" }),
    accept: vi.fn().mockResolvedValue(true),
  };
  const workflows = {
    create: vi.fn().mockResolvedValue({ status: 201, body: { id: "wf_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac", status: workflowStatus } }),
    action: vi.fn(),
  };
  return {
    repository,
    workflows,
    service: new DiscoveryService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workflows as never,
    ),
  };
}

function serviceForList() {
  const repository = {
    upsertSuggested: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([suggested]),
  };
  const runs = {
    list: vi.fn().mockResolvedValue({
      body: { data: [{ id: "run_1", status: "completed" }], page: { has_more: false, next_cursor: null, limit: 200 } },
    }),
  };
  const ads = {
    documents: vi.fn().mockResolvedValue({
      body: { data: [{ id: "doc_1", source_id: "src_1" }], page: { has_more: false, next_cursor: null } },
    }),
  };
  const actionCentre = {
    queue: vi.fn().mockImplementation((input: { status: string }) => Promise.resolve({
      data: [{ item: { id: `apr_${input.status}`, status: input.status } }],
      page: { has_more: false, next_cursor: null, limit: 200 },
      deferred: [],
    })),
  };
  const integrations = {
    listConnections: vi.fn().mockResolvedValue([{ id: "con_1", connector: "github" }]),
    activity: vi.fn().mockResolvedValue({
      data: [{ id: "act_1", action: "sync" }],
      page: { has_more: false, next_cursor: null, limit: 200 },
    }),
  };
  return {
    repository,
    runs,
    ads,
    actionCentre,
    integrations,
    service: new DiscoveryService(
      repository as never,
      runs as never,
      ads as never,
      actionCentre as never,
      integrations as never,
      {} as never,
    ),
  };
}

describe("scoreRecommendations", () => {
  it("returns deterministic ranked output for identical real-source signals", () => {
    expect(scoreRecommendations(signals)).toEqual(scoreRecommendations(structuredClone(signals)));
  });

  it("does not invent a recommendation when repeated approvals are absent", () => {
    expect(scoreRecommendations({ ...signals, decidedApprovals: signals.decidedApprovals.slice(0, 1) })).toEqual([]);
  });

  it("requires every named source signal and calculates low/high risk consistently", () => {
    expect(scoreRecommendations({ ...signals, runs: [] })).toEqual([]);
    expect(scoreRecommendations({ ...signals, adsDocuments: [] })).toEqual([]);
    expect(scoreRecommendations({ ...signals, connectorActivity: [] })).toEqual([]);
    expect(scoreRecommendations({ ...signals, decidedApprovals: [{ id: "apr_1", kind: "approved" }, { id: "apr_2", kind: "approved" }] })[0]?.riskLevel).toBe("low");
    expect(scoreRecommendations({ ...signals, decidedApprovals: [{ id: "apr_1", kind: "rejected" }, { id: "apr_2", kind: "rejected" }] })[0]?.riskLevel).toBe("high");
  });
});

describe("DiscoveryService accept", () => {
  it("creates only a draft workflow and links it to the accepted recommendation", async () => {
    const { repository, workflows, service } = serviceForAccept();

    const recommendation = await service.accept(suggested.id, actor, undefined, "idem-discovery-1");

    expect(workflows.create).toHaveBeenCalledWith(
      { goal: suggested.problemStatement },
      actor,
      undefined,
      "idem-discovery-1",
    );
    expect(workflows.action).not.toHaveBeenCalled();
    expect(repository.accept).toHaveBeenCalledWith(
      actor.tenant_id,
      actor.workspace_id,
      suggested.id,
      "wf_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaac",
    );
    expect(recommendation.status).toBe("accepted");
  });

  it("does not accept when workflow creation is not draft", async () => {
    const { repository, service } = serviceForAccept("active");

    await expect(service.accept(suggested.id, actor, undefined, "idem-discovery-2")).rejects.toMatchObject({
      status: 502,
    });
    expect(repository.accept).not.toHaveBeenCalled();
  });

  it("does not mark a recommendation accepted when its update loses a race", async () => {
    const { repository, service } = serviceForAccept();
    repository.accept.mockResolvedValue(false);

    await expect(service.accept(suggested.id, actor, undefined, "idem-discovery-3")).rejects.toMatchObject({ status: 409 });
  });

  it("rejects missing, already-decided, and malformed workflow responses", async () => {
    const missing = new DiscoveryService({ find: vi.fn().mockResolvedValue(undefined) } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(missing.accept(suggested.id, actor, undefined, "idem-discovery-4")).rejects.toMatchObject({ status: 404 });

    const decided = new DiscoveryService({ find: vi.fn().mockResolvedValue({ ...suggested, status: "dismissed" }) } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(decided.accept(suggested.id, actor, undefined, "idem-discovery-5")).rejects.toMatchObject({ status: 409 });

    const { repository, workflows, service } = serviceForAccept();
    workflows.create.mockResolvedValue({ status: 201, body: { id: null, status: "draft" } });
    await expect(service.accept(suggested.id, actor, undefined, "idem-discovery-6")).rejects.toMatchObject({ status: 502 });
    expect(repository.accept).not.toHaveBeenCalled();
  });

  it("fails closed when accepted recommendation cannot be read back", async () => {
    const { repository, service } = serviceForAccept();
    repository.find.mockReset().mockResolvedValueOnce(suggested).mockResolvedValueOnce(undefined);

    await expect(service.accept(suggested.id, actor, undefined, "idem-discovery-7")).rejects.toMatchObject({ status: 502 });
  });
});

describe("DiscoveryService sources and tenant scope", () => {
  it("uses only requesting tenant/workspace data from every real source service", async () => {
    const { repository, runs, ads, actionCentre, integrations, service } = serviceForList();

    await expect(service.list(actor, undefined)).resolves.toEqual([suggested]);

    expect(runs.list).toHaveBeenCalledWith({ cursor: undefined, limit: 200 }, actor, undefined);
    expect(ads.documents).toHaveBeenCalledWith({ cursor: undefined, limit: 200 }, actor, undefined);
    expect(actionCentre.queue).toHaveBeenCalledWith(
      { cursor: undefined, limit: 200, type: "approval", status: "approved" },
      actor,
      undefined,
    );
    expect(integrations.listConnections).toHaveBeenCalledWith(actor.tenant_id, actor.workspace_id);
    expect(integrations.activity).toHaveBeenCalledWith(actor.tenant_id, actor.workspace_id, "con_1", { cursor: undefined, limit: 200 });
    expect(repository.upsertSuggested).toHaveBeenCalledWith(
      actor.tenant_id,
      actor.workspace_id,
      expect.stringMatching(/^rec_/),
      expect.objectContaining({ requiredIntegrations: ["github"] }),
    );
    expect(repository.list).toHaveBeenCalledWith(actor.tenant_id, actor.workspace_id);
  });

  it("rejects a malformed source page instead of mining an incomplete history", async () => {
    const { runs, service } = serviceForList();
    runs.list.mockResolvedValue({
      body: { data: [], page: { has_more: true, next_cursor: null, limit: 200 } },
    });

    await expect(service.list(actor, undefined)).rejects.toMatchObject({ status: 502 });
  });

  it("follows valid source cursors and requires workspace scope", async () => {
    const { runs, integrations, service } = serviceForList();
    runs.list
      .mockResolvedValueOnce({ body: { data: [{ id: "run_1", status: "completed" }], page: { has_more: true, next_cursor: "next", limit: 200 } } })
      .mockResolvedValueOnce({ body: { data: [{ id: "run_2", status: "completed" }], page: { has_more: false, next_cursor: null, limit: 200 } } });
    integrations.activity
      .mockResolvedValueOnce({ data: [{ id: "act_1", action: "sync" }], page: { has_more: true, next_cursor: "activity-next", limit: 200 } })
      .mockResolvedValueOnce({ data: [{ id: "act_2", action: "sync" }], page: { has_more: false, next_cursor: null, limit: 200 } });
    await expect(service.list(actor, undefined)).resolves.toEqual([suggested]);
    expect(runs.list).toHaveBeenLastCalledWith({ cursor: "next", limit: 200 }, actor, undefined);
    expect(integrations.activity).toHaveBeenLastCalledWith(actor.tenant_id, actor.workspace_id, "con_1", { cursor: "activity-next", limit: 200 });
    const actorWithoutWorkspace = {
      user_id: actor.user_id,
      tenant_id: actor.tenant_id,
      roles: actor.roles,
      permissions: actor.permissions,
      session_id: actor.session_id,
    };
    await expect(service.list(actorWithoutWorkspace, undefined)).rejects.toMatchObject({ status: 403 });
  });

  it("dismisses only a currently suggested recommendation in caller workspace", async () => {
    const repository = {
      find: vi.fn().mockResolvedValue(suggested),
      dismiss: vi.fn().mockResolvedValue(true),
    };
    const service = new DiscoveryService(repository as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    await expect(service.dismiss(suggested.id, actor)).resolves.toBeUndefined();
    expect(repository.find).toHaveBeenCalledWith(actor.tenant_id, actor.workspace_id, suggested.id);
    expect(repository.dismiss).toHaveBeenCalledWith(actor.tenant_id, actor.workspace_id, suggested.id);
  });

  it("does not dismiss an already decided recommendation", async () => {
    const repository = { find: vi.fn().mockResolvedValue({ ...suggested, status: "accepted" }) };
    const service = new DiscoveryService(repository as never, {} as never, {} as never, {} as never, {} as never, {} as never);

    await expect(service.dismiss(suggested.id, actor)).rejects.toMatchObject({ status: 409 });
  });
});
