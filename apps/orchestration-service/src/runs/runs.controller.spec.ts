import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  RunLauncherService,
  RunNotFoundError,
  RunStartFailedError,
  RunStateConflictError,
  RunValidationError,
  WorkflowNotFoundError,
} from "./run-launcher.service";
import { RunOutcomeService } from "./run-outcome.service";
import { RunsController } from "./runs.controller";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const WORKFLOW = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function launcher(): RunLauncherService {
  return {
    createRun: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    cancelRun: vi.fn(),
    retryNode: vi.fn(),
  } as unknown as RunLauncherService;
}

function outcomes(): RunOutcomeService {
  return {
    getByRunId: vi.fn(),
  } as unknown as RunOutcomeService;
}

function request(tenantId: string | undefined = TENANT) {
  return { actorContext: tenantId === undefined ? undefined : { tenant_id: tenantId }, url: `/api/v1/runs` };
}

function runRow(status = "pending") {
  return {
    id: RUN,
    workflow_id: WORKFLOW,
    workflow_version_id: null,
    parent_kind: "workflow",
    status,
    started_at: null,
    ended_at: null,
    created_at: "2026-07-28T00:00:00.000Z",
  };
}

function fakeReply() {
  return { header: vi.fn() };
}

describe("RunsController.create", () => {
  it("creates a run and sets the Location header", async () => {
    const service = launcher();
    vi.mocked(service.createRun).mockResolvedValue(runRow());
    const reply = fakeReply();

    const response = await new RunsController(service, outcomes()).create(
      request() as never,
      reply as never,
      { workflow_id: WORKFLOW },
    );

    expect(service.createRun).toHaveBeenCalledWith(TENANT, WORKFLOW, undefined);
    expect(reply.header).toHaveBeenCalledWith("location", `/api/v1/runs/${RUN}`);
    expect(response).toMatchObject({ id: RUN, status: "pending" });
  });

  it("rejects a missing workflow_id with a 400 ProblemDetails", async () => {
    const service = launcher();
    await expect(
      new RunsController(service, outcomes()).create(request() as never, fakeReply() as never, {} as never),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 400 }) });
    expect(service.createRun).not.toHaveBeenCalled();
  });

  it("maps WorkflowNotFoundError to 404", async () => {
    const service = launcher();
    vi.mocked(service.createRun).mockRejectedValue(new WorkflowNotFoundError(WORKFLOW));

    await expect(
      new RunsController(service, outcomes()).create(request() as never, fakeReply() as never, {
        workflow_id: WORKFLOW,
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 404 }) });
  });

  it("maps RunStartFailedError to 502", async () => {
    const service = launcher();
    vi.mocked(service.createRun).mockRejectedValue(new RunStartFailedError(RUN, new Error("x")));

    await expect(
      new RunsController(service, outcomes()).create(request() as never, fakeReply() as never, {
        workflow_id: WORKFLOW,
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 502 }) });
  });

  it("maps RunValidationError to 400", async () => {
    const service = launcher();
    vi.mocked(service.createRun).mockRejectedValue(new RunValidationError("no promoted version"));

    await expect(
      new RunsController(service, outcomes()).create(request() as never, fakeReply() as never, {
        workflow_id: WORKFLOW,
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 400 }) });
  });

  it("returns 500 with real ProblemDetails identifiers when tenant context is missing", async () => {
    await expect(
      new RunsController(launcher(), outcomes()).create(
        request(undefined) as never,
        fakeReply() as never,
        { workflow_id: WORKFLOW },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        status: 500,
        trace_id: expect.stringMatching(/^trc_[0-9a-f-]+$/i),
        request_id: expect.stringMatching(/^req_[0-9a-f-]+$/i),
      }),
    });
  });
});

describe("RunsController.list/get", () => {
  it("lists runs tenant-scoped with query filters", async () => {
    const service = launcher();
    vi.mocked(service.listRuns).mockResolvedValue({
      data: [runRow("running")],
      page: { next_cursor: null, has_more: false, limit: 50 },
    });

    const response = await new RunsController(service, outcomes()).list(request() as never, {
      workflow_id: WORKFLOW,
      status: "running",
    });

    expect(service.listRuns).toHaveBeenCalledWith(TENANT, {
      workflowId: WORKFLOW,
      status: "running",
    });
    expect(response.data).toHaveLength(1);
  });

  it("maps RunNotFoundError to 404 on get", async () => {
    const service = launcher();
    vi.mocked(service.getRun).mockRejectedValue(new RunNotFoundError(RUN));

    await expect(
      new RunsController(service, outcomes()).get(request() as never, RUN),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 404 }) });
  });
});

describe("RunsController.cancel", () => {
  it("cancels a run", async () => {
    const service = launcher();
    vi.mocked(service.cancelRun).mockResolvedValue(runRow("cancelled"));

    const response = await new RunsController(service, outcomes()).cancel(request() as never, RUN);
    expect(response).toMatchObject({ status: "cancelled" });
  });
});

describe("RunsController.retryNode", () => {
  it("retries a node and rejects a missing node_key", async () => {
    const service = launcher();
    await expect(
      new RunsController(service, outcomes()).retryNode(request() as never, RUN, {} as never),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 400 }) });
    expect(service.retryNode).not.toHaveBeenCalled();
  });

  it("maps RunStateConflictError to 409", async () => {
    const service = launcher();
    vi.mocked(service.retryNode).mockRejectedValue(
      new RunStateConflictError("retry-node requires run status failed"),
    );

    await expect(
      new RunsController(service, outcomes()).retryNode(request() as never, RUN, { node_key: "node_a" }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 409 }) });
  });

  it("succeeds and returns the running run", async () => {
    const service = launcher();
    vi.mocked(service.retryNode).mockResolvedValue(runRow("running"));

    const response = await new RunsController(service, outcomes()).retryNode(request() as never, RUN, {
      node_key: "node_a",
    });
    expect(response).toMatchObject({ status: "running" });
    expect(service.retryNode).toHaveBeenCalledWith(TENANT, RUN, "node_a");
  });
});

describe("RunsController error mapping fallback", () => {
  it("maps an unknown error to 500", async () => {
    const service = launcher();
    vi.mocked(service.getRun).mockRejectedValue(new Error("unexpected"));

    await expect(new RunsController(service, outcomes()).get(request() as never, RUN)).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
