import http from 'k6/http';
import { check, sleep } from 'k6';

import { recordResponse, requestParams, requiredEnv, summary } from './common.js';

const floors = JSON.parse(open('./slo-floors.json'));
const baseUrl = requiredEnv('BASE_URL');
const runStartPath = requiredEnv('RUN_START_PATH');
const runStartBody = requiredEnv('RUN_START_BODY');

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: [`p(95)<${floors.run_start.p95_ms}`],
    availability: [`rate>${floors.api_read_control.availability}`],
    unexpected_responses: ['count==0'],
  },
};

export default function () {
  const response = http.post(`${baseUrl}${runStartPath}`, runStartBody, requestParams());
  check(response, { 'run accepted': (value) => recordResponse(value, [201, 202]) });
  sleep(0.5);
}

export function handleSummary(data) {
  return summary(data, 'run-start');
}
