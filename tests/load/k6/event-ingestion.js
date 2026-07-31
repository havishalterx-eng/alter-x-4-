import http from 'k6/http';
import { check } from 'k6';

import { recordResponse, requestParams, requiredEnv, summary } from './common.js';

const floors = JSON.parse(open('./slo-floors.json'));
const baseUrl = requiredEnv('BASE_URL');
const eventPath = requiredEnv('EVENT_INGEST_PATH');
const eventBody = requiredEnv('EVENT_INGEST_BODY');

export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: floors.event_ingestion.sustained_events_per_second,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 100,
      maxVUs: 300,
    },
    burst: {
      executor: 'constant-arrival-rate',
      startTime: '5m',
      rate: floors.event_ingestion.burst_events_per_second,
      timeUnit: '1s',
      duration: floors.event_ingestion.burst_duration,
      preAllocatedVUs: 300,
      maxVUs: 750,
    },
  },
  thresholds: {
    availability: [`rate>${floors.api_read_control.availability}`],
    unexpected_responses: ['count==0'],
  },
};

export default function () {
  const response = http.post(`${baseUrl}${eventPath}`, eventBody, requestParams());
  check(response, { 'event acknowledged': (value) => recordResponse(value, [200, 201, 202, 204]) });
}

export function handleSummary(data) {
  return summary(data, 'event-ingestion');
}
