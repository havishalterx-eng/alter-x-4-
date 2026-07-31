import { Counter, Rate } from 'k6/metrics';

export const degradedResponses = new Counter('degraded_responses');
export const unexpectedResponses = new Counter('unexpected_responses');
export const availability = new Rate('availability');

export function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} must be set for a real k6 load run`);
  }
  return value;
}

export function requestParams() {
  return {
    headers: {
      Authorization: `Bearer ${requiredEnv('ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      'X-Request-Id': `${__VU}-${__ITER}`,
    },
    tags: { surface: 'platform-api' },
  };
}

export function recordResponse(response, expectedStatuses) {
  const expected = expectedStatuses.includes(response.status);
  availability.add(expected);
  if (!expected) {
    unexpectedResponses.add(1);
  }
  if (response.status === 429 || response.status >= 500) {
    degradedResponses.add(1);
  }
  return expected;
}

export function summary(data, name) {
  return {
    stdout: JSON.stringify(data, null, 2),
    [`results/${name}-summary.json`]: JSON.stringify(data, null, 2),
  };
}
