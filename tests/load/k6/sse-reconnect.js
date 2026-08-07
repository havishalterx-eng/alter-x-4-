import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import http from 'k6/http';
import sse from 'k6/x/sse';

import { requiredEnv, summary } from './common.js';

const floors = JSON.parse(open('./slo-floors.json'));
const baseUrl = requiredEnv('BASE_URL');
const streamPath = requiredEnv('RUN_STREAM_PATH');
const healthPath = requiredEnv('STREAM_HEALTH_PATH');
const accessToken = requiredEnv('ACCESS_TOKEN');

const acceptedConnections = new Rate('sse_connections_accepted');
const connectionDuration = new Trend('sse_connection_duration', true);
const reconnects = new Counter('sse_reconnects');
const streamErrors = new Counter('sse_stream_errors');
const gatewayHealthy = new Rate('sse_gateway_healthy');

export const options = {
  stages: [
    { duration: '30s', target: 25 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    sse_connections_accepted: [`rate>${floors.sse_reconnect.acceptance}`],
    sse_connection_duration: [`p(95)<${floors.sse_reconnect.p95_connect_ms}`],
    sse_stream_errors: ['count==0'],
    sse_gateway_healthy: [`rate>${floors.sse_reconnect.acceptance}`],
    'http_req_duration{scenario:reconnect-health}': [`p(95)<${floors.api_read_control.p95_ms}`],
  },
};

export default function () {
  const startedAt = Date.now();
  let opened = false;
  const response = sse.open(
    `${baseUrl}${streamPath}?tab_id=k6-${__VU}-${__ITER}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/event-stream',
      },
      tags: { surface: 'streaming-gateway', scenario: 'reconnect-storm' },
    },
    (client) => {
      client.on('open', () => {
        opened = true;
        reconnects.add(1);
        connectionDuration.add(Date.now() - startedAt);
      });
      client.on('event', () => client.close());
      client.on('error', () => {
        streamErrors.add(1);
        client.close();
      });
    },
  );
  acceptedConnections.add(opened && response && response.status === 200);
  check(response, { 'SSE connection accepted': (value) => value && value.status === 200 });
  const health = http.get(`${baseUrl}${healthPath}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    tags: { surface: 'streaming-gateway', scenario: 'reconnect-health' },
  });
  gatewayHealthy.add(health.status === 200);
  check(health, { 'gateway remains healthy': (value) => value.status === 200 });
  sleep(0.05);
}

export function handleSummary(data) {
  return summary(data, 'sse-reconnect');
}
