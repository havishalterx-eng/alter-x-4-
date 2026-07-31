import http from 'k6/http';
import { check, sleep } from 'k6';

import { recordResponse, requestParams, requiredEnv, summary } from './common.js';

const floors = JSON.parse(open('./slo-floors.json'));
const baseUrl = requiredEnv('BASE_URL');
const readPath = requiredEnv('API_READ_PATH');
const controlPath = requiredEnv('API_CONTROL_PATH');
const controlBody = requiredEnv('API_CONTROL_BODY');

export const options = {
  stages: [
    { duration: '1m', target: 25 },
    { duration: '5m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: [
      `p(95)<${floors.api_read_control.p95_ms}`,
      `p(99)<${floors.api_read_control.p99_ms}`,
    ],
    availability: [`rate>${floors.api_read_control.availability}`],
    unexpected_responses: ['count==0'],
  },
};

export default function () {
  const isRead = __ITER % 4 !== 3;
  const response = isRead
    ? http.get(`${baseUrl}${readPath}`, requestParams())
    : http.post(`${baseUrl}${controlPath}`, controlBody, requestParams());
  check(response, { 'expected response': (value) => recordResponse(value, [200, 201, 202, 204]) });
  sleep(0.2);
}

export function handleSummary(data) {
  return summary(data, 'api-mix');
}
