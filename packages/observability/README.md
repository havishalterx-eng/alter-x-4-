# `@alterx/observability`

Process bootstrap for ALTER observability. Apps create the concrete adapter with
secret reference IDs, then start it before loading application modules.

```ts
import { createObservabilityProvider } from "@alterx/adapters/observability";
import { initObservability } from "@alterx/observability";

const provider = await createObservabilityProvider(
  {
    serviceName: "orchestration-service",
    serviceVersion: "1.0.0",
    environment: "prod",
    grafanaInstanceId: "configured-stack-id",
    grafanaOtlpEndpointReference:
      "/alter/prod/observability/grafana/otlp-endpoint",
    grafanaApiKeyReference: "/alter/prod/observability/grafana/api-key",
    sentryDsnReference: "/alter/prod/observability/sentry/dsn",
  },
  secretsProvider,
);

const observability = await initObservability(provider);
// Register `observability.shutdown()` in the app's existing shutdown hook.
```

No endpoint, API key, or DSN is accepted directly by the factory. All three are
resolved through `SecretsProvider` at startup. Missing references fail startup.

## Runtime decisions

- Traces, histogram metric points, and structured logs use OTLP/HTTP batch
  exporters to Grafana Cloud.
- Grafana Cloud authentication uses Basic auth generated from configured stack
  ID plus API key resolved at runtime.
- Errors use Sentry's Node SDK. Sentry OTel setup is disabled so one NodeSDK owns
  global OTel registration.
- Emit methods use SDK buffering and contain synchronous exporter/mapping
  failures; health becomes degraded instead of crashing the service.
- Health performs a bounded authenticated `HEAD` probe against the OTLP trace
  route. Network/5xx is unhealthy; 401/403 or contained emit failures are
  degraded.
- Automatic HTTP/gRPC/Postgres instrumentation is deferred until each app adopts
  this bootstrap, so instrumentation can load before that app's framework and
  database modules.
