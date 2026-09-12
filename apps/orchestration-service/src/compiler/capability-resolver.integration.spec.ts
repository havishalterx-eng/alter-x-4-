import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapabilityServiceClient } from "@alterx/adapters";

import { compileTaskSkeletonToDag, parseTaskSkeleton } from "./dag-builder";
import { CAPABILITY_CLIENT_PROTO_PATH } from "./capability-client.constants";

// Shared internal-service credential for the spawned intelligence-service.
// Must match the SHA-256 the callee enforces (apps/intelligence-service/tests/conftest.py).
const INTERNAL_SERVICE_TOKEN = "integration-token";
const INTERNAL_SERVICE_TOKEN_SHA256 = createHash("sha256")
  .update(INTERNAL_SERVICE_TOKEN)
  .digest("hex");

const TENANT_ID = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected TCP address");
  const { port } = address;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

describe.sequential("Capability Resolver gRPC", () => {
  let resolver: ChildProcess;
  let address: string;

  beforeAll(async () => {
    address = `127.0.0.1:${await availablePort()}`;
    resolver = spawn(process.platform === "win32" ? "uv.exe" : "uv", ["run", "uvicorn", "src.main:app", "--port", String(await availablePort())], {
      cwd: resolve(process.cwd(), "apps/intelligence-service"),
      env: {
        ...process.env,
        CAPABILITY_GRPC_BIND_ADDRESS: address,
        INTERNAL_SERVICE_TOKEN_SHA256,
      },
      stdio: "ignore",
    });
    await new Promise<void>((resolveReady, rejectReady) => {
      const deadline = setTimeout(() => rejectReady(new Error("Capability Resolver did not start")), 20_000);
      const client = new CapabilityServiceClient({ address, protoPath: CAPABILITY_CLIENT_PROTO_PATH, authorization: INTERNAL_SERVICE_TOKEN, timeoutMs: 250 });
      const check = async (): Promise<void> => {
        try {
          await client.resolveNodeRequirements({
            tenant_id: TENANT_ID,
            run_id: "",
            node_key: "ready",
            node_type: "Gate",
            node_config_json: "{}",
          });
          clearTimeout(deadline);
          resolveReady();
        } catch {
          setTimeout(check, 100);
        }
      };
      void check();
    });
  }, 30_000);

  afterAll(() => resolver?.kill());

  it("rejects an unauthenticated caller (UNAUTHENTICATED)", async () => {
    // No valid internal-service token -> the gRPC interceptor must reject.
    const client = new CapabilityServiceClient({
      address,
      protoPath: CAPABILITY_CLIENT_PROTO_PATH,
      authorization: "",
      timeoutMs: 250,
    });
    await expect(
      client.resolveNodeRequirements({
        tenant_id: TENANT_ID,
        run_id: "",
        node_key: "ready",
        node_type: "Gate",
        node_config_json: "{}",
      }),
    ).rejects.toThrow();
  });

  // The compiler used to make this call, once per node, to fill a column
  // nothing read; 0037 dropped the column and the round trip with it. The
  // resolver itself is still on the live path -- NodeExecService and
  // RecoveryDispatchService each call it per node, per run -- so the coverage
  // moves to that call rather than disappearing with its old caller. Nodes are
  // still produced by the real lowering, so this asserts the resolver against
  // every node shape the compiler actually emits, exactly as before.
  it("answers for every node the compiler emits, through the live typed resolver", async () => {
    const client = new CapabilityServiceClient({ address, protoPath: CAPABILITY_CLIENT_PROTO_PATH, authorization: INTERNAL_SERVICE_TOKEN });
    const dag = compileTaskSkeletonToDag(
      parseTaskSkeleton(JSON.stringify({
        version: "1",
        entry_point: "summarize",
        nodes: [
          { key: "summarize", type: "llm", config: { prompt: "Summarize this report" }, depends_on: [] },
          { key: "search", type: "tool", config: { tool_name: "search.web", tool_version: "v1", permissions: ["web:read"] }, depends_on: ["summarize"] },
        ],
      })),
      "1",
    );

    const resolved = Object.fromEntries(
      await Promise.all(dag.nodes.map(async (node) => [
        node.key,
        JSON.parse(
          (await client.resolveNodeRequirements({
            tenant_id: TENANT_ID,
            run_id: "",
            node_key: node.key,
            node_type: node.type,
            node_config_json: JSON.stringify(node.config),
          })).node_requirements_json,
        ),
      ])),
    );

    expect(resolved).toEqual({
      summarize: { capabilities: ["text.generation", "text.summarization"], model_alias: "FAST" },
      search: { capabilities: [], tools: [{ name: "search.web", version: "v1", permissions: ["web:read"] }] },
      verify_step_0: { capabilities: [] },
    });
  });
});
