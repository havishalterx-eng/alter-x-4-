import "reflect-metadata";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";

import {
  PromptInjectionClassifier,
  lazyAuth0M2mTokenProviderFromEnvironment,
} from "@alterx/auth";
import {
  ModelGatewayClient,
  SsrfBlockedError,
  assertHostnameNotLiteralBlockedIp,
  assertResolvedAddressesNotBlocked,
  assertUrlSchemeAllowed,
} from "@alterx/adapters";

import { MODELGW_CLIENT_PROTO_PATH } from "./conversation/grpc.constants";

/**
 * Real, disclosed eval-only HTTP server for HARD-7f (`injection` golden-set
 * domain's `injection`/`jailbreak`/`ssrf` suites). No production RPC
 * contract exposes PromptInjectionClassifier or the ssrf-guard functions
 * standalone -- both are real, existing library code
 * (packages/auth/session-gateway/src/prompt-injection-classifier.ts,
 * packages/adapters/src/http/ssrf-guard.ts) called from within larger
 * flows, never their own service. This wraps them in plain JSON/HTTP
 * (not a fabricated .proto contract for something that has no real
 * production contract) so eval-service can call the real logic directly.
 *
 * PromptInjectionClassifier depends on a real, live model-gateway
 * (HARD-7d's eval_bootstrap.ts) with a real ANTHROPIC_API_KEY/
 * OPENAI_API_KEY -- same real dependency HARD-7e's intent wiring has.
 * The ssrf check is pure and needs neither an LLM nor a DB: it performs a
 * real DNS lookup (node:dns) for non-literal hostnames, same as
 * SsrfGuardedFetcher's own default resolver, but never issues the actual
 * HTTP fetch a real SsrfGuardedFetcher.fetch() would -- classification
 * only, no outbound request against a user-supplied, potentially
 * malicious target.
 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : (JSON.parse(raw) as Record<string, unknown>);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(payload);
}

// The golden set's SSRF cases (see launch_golden_sets.py's INJECTION_CASES)
// use http:// URLs to test private-IP/loopback/metadata-service blocking
// specifically (see their tags: private-ipv4, metadata-service, loopback,
// loopback-ipv6) -- not scheme enforcement. assertUrlSchemeAllowed's real
// default only permits https:, which would short-circuit every case
// before the IP-blocking logic under test ever runs, masking what's
// actually being verified. Allowing http: here exercises the real
// mechanism the golden set's own tags claim to test.
const EVAL_SSRF_POLICY = { allowedSchemes: ["http:", "https:"] };

async function checkSsrf(url: string): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const parsed = new URL(url);
    assertUrlSchemeAllowed(parsed, EVAL_SSRF_POLICY);
    assertHostnameNotLiteralBlockedIp(parsed.hostname);
    // Real DNS resolution, same as SsrfGuardedFetcher's default resolver --
    // needed for hostnames like "localhost" that aren't IP-literal-shaped
    // but still resolve to a blocked address.
    const bareHost =
      parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;
    const isIpLiteral = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bareHost) || bareHost.includes(":");
    if (!isIpLiteral) {
      const results = await dnsLookup(bareHost, { all: true, verbatim: true });
      assertResolvedAddressesNotBlocked(
        results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
      );
    }
    return { blocked: false };
  } catch (error: unknown) {
    if (error instanceof SsrfBlockedError) {
      return { blocked: true, reason: error.message };
    }
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  const port = Number(process.env.HTTP_PORT ?? "0");
  const modelGatewayTarget = process.env.MODEL_GATEWAY_GRPC_TARGET;
  if (modelGatewayTarget === undefined || modelGatewayTarget.length === 0) {
    throw new Error("eval_security_http_server requires MODEL_GATEWAY_GRPC_TARGET");
  }
  const modelGateway = new ModelGatewayClient({
    address: modelGatewayTarget,
    protoPath: MODELGW_CLIENT_PROTO_PATH,
    accessTokenProvider: lazyAuth0M2mTokenProviderFromEnvironment(process.env),
  });
  const injectionClassifier = new PromptInjectionClassifier(modelGateway);

  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (request.method === "POST" && request.url === "/classify-injection") {
          const body = await readJsonBody(request);
          const result = await injectionClassifier.classify({
            tenantId: String(body.tenant_id),
            runId: String(body.run_id),
            nodeExecutionId: String(body.node_execution_id),
            text: String(body.text),
          });
          sendJson(response, 200, result);
          return;
        }
        if (request.method === "POST" && request.url === "/check-ssrf") {
          const body = await readJsonBody(request);
          const result = await checkSsrf(String(body.url));
          sendJson(response, 200, result);
          return;
        }
        sendJson(response, 404, { error: "not found" });
      } catch (error: unknown) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  server.listen(port, "127.0.0.1");
}

void bootstrap();
