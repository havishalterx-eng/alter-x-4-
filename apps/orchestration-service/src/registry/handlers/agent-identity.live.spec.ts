import { randomUUID } from "node:crypto";

import { ModelGatewayClient } from "@alterx/adapters";
import { describe, expect, it } from "vitest";

import { MODELGW_CLIENT_PROTO_PATH } from "../../conversation/grpc.constants";
import { internalM2mTokenProvider } from "../../orchestration-infrastructure.module";
import type { NodeExecutionContext } from "../handler";
import { AGENT_IDENTITY_CASES } from "./agent-identity.golden";
import { LlmTaskHandler } from "./llmtask.handler";

/**
 * Scores the agent identity golden set against a real Model Gateway. Skipped
 * unless AGENT_IDENTITY_LIVE_MODEL_GATEWAY names one (e.g. 127.0.0.1:50051
 * with scripts/run-model-gateway-aws.sh and the local M2M issuer running):
 * a model is the thing under test, so there is nothing to score in CI.
 */
const address = process.env["AGENT_IDENTITY_LIVE_MODEL_GATEWAY"];
const uuid7 = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

describe.skipIf(!address)("agent identity golden set, live", () => {
  it("scores every case through LlmTaskHandler", { timeout: 300_000 }, async () => {
    const handler = new LlmTaskHandler(
      new ModelGatewayClient({
        address: address!,
        protoPath: MODELGW_CLIENT_PROTO_PATH,
        accessTokenProvider: internalM2mTokenProvider(),
        timeoutMs: 60_000,
      }),
    );
    const tenant = `ten_${uuid7()}`;
    const lines: string[] = [];
    let passed = 0;
    for (const golden of AGENT_IDENTITY_CASES) {
      const context = {
        config: { model_alias: "STANDARD", prompt: golden.nodePrompt },
        inputs: {},
        tenant_id: tenant,
        run_id: `run_${uuid7()}`,
        node_execution_id: `node_${uuid7()}`,
        agent_id: `agt_${golden.id}`,
        bound_model_alias: "STANDARD",
        // AGENT_IDENTITY_OMIT_INSTRUCTIONS=1 scores the same cases with no
        // instructions delivered: the baseline that shows the set measures them.
        ...(process.env["AGENT_IDENTITY_OMIT_INSTRUCTIONS"] === "1" ? {} : { bound_agent_instructions: golden.agentInstructions }),
      } satisfies NodeExecutionContext;
      let failure: string | undefined;
      let output: Record<string, unknown> = {};
      try {
        output = (await handler.execute(context)).output;
        failure = golden.check(output);
      } catch (error) {
        failure = `execute failed: ${(error as Error).message}`;
      }
      if (failure === undefined) passed += 1;
      lines.push(`${failure === undefined ? "PASS" : "FAIL"} ${golden.id}: ${failure ?? ""} ${JSON.stringify(output).slice(0, 160)}`);
    }
    console.log(`agent identity golden set: ${passed}/${AGENT_IDENTITY_CASES.length}\n${lines.join("\n")}`);
    expect(lines).toHaveLength(AGENT_IDENTITY_CASES.length);
  });
});
