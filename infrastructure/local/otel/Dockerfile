ARG OTEL_IMAGE=otel/opentelemetry-collector-contrib:0.157.0
FROM ${OTEL_IMAGE} AS collector

FROM busybox:1.37.0
COPY --from=collector /otelcol-contrib /otelcol-contrib
USER 10001:10001
ENTRYPOINT ["/otelcol-contrib"]
