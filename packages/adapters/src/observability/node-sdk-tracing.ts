import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";

export interface NodeSdkTracingConfig {
  readonly serviceName: string;
  readonly otlpUrl?: string;
}

/**
 * Boots NodeSDK auto-instrumentation for a service's local OTLP collector
 * (Tempo). Vendor-SDK entrypoint for the process's tracing.ts, kept here so
 * app code never imports @opentelemetry/* directly (architecture-boundary
 * law: vendor SDK imports must live under packages/adapters/**).
 */
export function startNodeSdkTracing(config: NodeSdkTracingConfig): NodeSDK {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
    }),
    traceExporter: new OTLPTraceExporter({
      url: config.otlpUrl ?? "http://127.0.0.1:4317",
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
          enabled: false,
        },
      }),
    ],
  });

  sdk.start();

  process.on("SIGTERM", () => {
    sdk
      .shutdown()
      .then(() => console.log("Tracing terminated"))
      .catch((error) => console.log("Error terminating tracing", error))
      .finally(() => process.exit(0));
  });

  return sdk;
}
