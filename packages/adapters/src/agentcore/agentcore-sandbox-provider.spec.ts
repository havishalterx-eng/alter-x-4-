import { describe, expect, it, vi } from "vitest";
import { AgentCoreSandboxProvider } from "./agentcore-sandbox-provider";

function resultStream(result: Record<string, unknown>) {
  return (async function* () {
    yield { result };
  })();
}

describe("AgentCoreSandboxProvider", () => {
  it("creates a session, executes tools, and stops the session", async () => {
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      switch (command.constructor.name) {
        case "StartCodeInterpreterSessionCommand":
          return { sessionId: "agentcore_ses_1" };
        case "InvokeCodeInterpreterCommand": {
          const input = (command as unknown as { input: { name: string } }).input;
          if (input.name === "writeFiles") return { stream: resultStream({ content: [] }) };
          if (input.name === "readFiles") return { stream: resultStream({ content: [{ text: "{}" }] }) };
          return {
            stream: resultStream({
              structuredContent: { stdout: "ok", stderr: "", exitCode: 0 },
              content: [{ text: "ok" }],
            }),
          };
        }
        case "StopCodeInterpreterSessionCommand":
          return {};
        default:
          throw new Error(`unexpected command ${command.constructor.name}`);
      }
    });
    const provider = new AgentCoreSandboxProvider({ region: "ap-south-1" }, { send });

    const session = await provider.createSession({
      tenantId: "ten_1",
      runId: "run_1",
      cycleId: "cycle_1",
      templateId: "aws.codeinterpreter.v1",
      environment: {},
    });
    expect(session.sessionId).toBe("agentcore_ses_1");

    await provider.writeFiles(session.sessionId, [{ path: "/workspace/prj_1/package.json", content: "{}" }]);
    await expect(provider.readFile(session.sessionId, "/workspace/prj_1/package.json")).resolves.toBe("{}");
    await expect(provider.execute(session.sessionId, "pnpm install")).resolves.toEqual({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });

    await provider.closeSession(session.sessionId);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("rejects operations against a session that was never created", async () => {
    const send = vi.fn();
    const provider = new AgentCoreSandboxProvider({ region: "ap-south-1" }, { send });
    await expect(provider.execute("unknown_session", "echo hi")).rejects.toThrow(
      "Sandbox session was not found",
    );
  });

  it("requires a non-empty region", () => {
    expect(() => new AgentCoreSandboxProvider({ region: "" })).toThrow(
      "AgentCore region is required",
    );
  });
});
