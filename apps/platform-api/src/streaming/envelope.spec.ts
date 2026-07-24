import { describe, expect, it } from "vitest";
import { platformEvent } from "./envelope";

const runId = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("platform stream envelopes", () => {
  it("re-envelopes canonical run events without exposing raw Engine shape", () => {
    expect(
      platformEvent(
        { kind: "run", runId },
        {
          id: "engine-1",
          event: "run.status",
          data: {
            seq: 1,
            event: "run.status",
            run_id: runId,
            ts: "2026-07-24T10:00:00.000Z",
            data: { status: "running" },
          },
        },
      ),
    ).toEqual({
      id: `${runId}:1`,
      type: "run.status",
      data: {
        runId,
        timestamp: "2026-07-24T10:00:00.000Z",
        payload: { status: "running" },
      },
      key: `run.status:${runId}`,
      coalescible: true,
    });
  });

  it("maps terminal output to ordered xterm-ready frames", () => {
    expect(
      platformEvent(
        { kind: "terminal", projectId, runId },
        {
          data: {
            seq: 2,
            event: "terminal.frame",
            run_id: runId,
            ts: "2026-07-24T10:00:01.000Z",
            data: { stream: "stdout", data: "\u001b[32mok\u001b[0m\r\n" },
          },
        },
      ),
    ).toMatchObject({
      id: `${runId}:2`,
      type: "terminal.frame",
      data: { stream: "stdout", data: "\u001b[32mok\u001b[0m\r\n" },
      coalescible: false,
    });
  });

  it("rejects cross-run and malformed Engine events", () => {
    expect(() =>
      platformEvent(
        { kind: "run", runId },
        {
          data: {
            seq: 1,
            event: "run.status",
            run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abd",
            ts: "2026-07-24T10:00:00.000Z",
            data: { status: "running" },
          },
        },
      ),
    ).toThrow("Engine run stream run mismatch");
    expect(() =>
      platformEvent(
        { kind: "terminal", projectId, runId },
        { data: { event: "terminal.frame" } },
      ),
    ).toThrow();
  });
});
