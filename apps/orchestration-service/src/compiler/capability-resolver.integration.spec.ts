import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapabilityServiceClient } from "@alterx/adapters";

import {
  GraphCompilerService,
  type OrchestrationTenantStore,
} from "./graph-compiler.service";
import { CAPABILITY_CLIENT_PROTO_PATH } from "./capability-client.constants";

const TENANT_ID = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const WORKFLOW_ID = "wf_018f47a5-7b2c-7d10-8f11-123456789abc";
// ENGINE-FIX-P5-SEC-1: intelligence-service now fails closed at startup
// without a configured digest, and its capability gRPC interceptor rejects
// every RPC without the matching raw token.
const SERVICE_TOKEN = "capability-resolver-spec-token";
const SERVICE_TOKEN_SHA256 = createHash("sha256").update(SERVICE_TOKEN).digest("hex");
const AUTHORIZATION = `Bearer ${SERVICE_TOKEN}`;

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

function fakeStore(): OrchestrationTenantStore {
  return {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
        ) {
          if (statement.includes("SELECT COALESCE(MAX(version)")) {
            return { rowCount: 1, rows: [{ next_version: 1 } as unknown as TRow] };
          }
          if (statement.includes("INSERT INTO workflow_versions")) {
            return { rowCount: 1, rows: [] as TRow[] };
          }
          throw new Error(`unexpected query: ${statement}`);
        },
      });
    },
  };
}

describe.sequential("Graph Compiler -> Capability Resolver gRPC", () => {
  let resolver: ChildProcess;
  let address: string;

  beforeAll(async () => {
    address = `127.0.0.1:${await availablePort()}`;
    const resolverOutput: string[] = [];
    resolver = spawn(process.platform === "win32" ? "uv.exe" : "uv", ["run", "uvicorn", "src.main:app", "--port", String(await availablePort())], {
      cwd: resolve(process.cwd(), "apps/intelligence-service"),
      env: {
        ...process.env,
        CAPABILITY_GRPC_BIND_ADDRESS: address,
        INTERNAL_SERVICE_TOKEN_SHA256: SERVICE_TOKEN_SHA256,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    resolver.stdout?.on("data", (chunk: Buffer) => resolverOutput.push(chunk.toString()));
    resolver.stderr?.on("data", (chunk: Buffer) => resolverOutput.push(chunk.toString()));
    await new Promise<void>((resolveReady, rejectReady) => {
      const deadline = setTimeout(
        () => rejectReady(new Error(`Capability Resolver did not start:\n${resolverOutput.join("")}`)),
        20_000,
      );
      const client = new CapabilityServiceClient({
        address,
        protoPath: CAPABILITY_CLIENT_PROTO_PATH,
        timeoutMs: 250,
        authorization: AUTHORIZATION,
      });
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

  it("compiles representative nodes through the live typed resolver", async () => {
    const compiler = new GraphCompilerService(
      fakeStore(),
      new CapabilityServiceClient({
        address,
        protoPath: CAPABILITY_CLIENT_PROTO_PATH,
        authorization: AUTHORIZATION,
      }),
    );
    const result = await compiler.compileWorkflow({
      tenant_id: TENANT_ID,
      workflow_id: WORKFLOW_ID,
      dag_schema_version: "1",
      task_skeleton_json: JSON.stringify({
        version: "1",
        entry_point: "summarize",
        nodes: [
          { key: "summarize", type: "llm", config: { prompt: "Summarize this report" }, depends_on: [] },
          { key: "search", type: "tool", config: { tool_name: "search.web", tool_version: "v1", permissions: ["web:read"] }, depends_on: ["summarize"] },
        ],
      }),
    });

    expect(JSON.parse(result.node_requirements_json)).toEqual({
      summarize: { capabilities: ["text.generation", "text.summarization"], model_alias: "FAST" },
      search: { capabilities: [], tools: [{ name: "search.web", version: "v1", permissions: ["web:read"] }] },
      verify_step_0: { capabilities: [] },
    });
  });
});
