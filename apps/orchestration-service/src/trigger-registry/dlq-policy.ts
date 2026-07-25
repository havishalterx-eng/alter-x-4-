export class InvalidDlqPolicyError extends Error {
  constructor(reason: string) {
    super(`Invalid DLQ policy: ${reason}`);
    this.name = "InvalidDlqPolicyError";
  }
}

export interface DlqPolicy {
  readonly maxReceiveCount: number;
  readonly visibilityTimeoutSeconds: number;
}

// Bounds mirror the real SQS limits already applied to the canonical queue
// and its DLQ in FOUND-5's Terraform (infrastructure/terraform/modules/messaging/main.tf) --
// a per-trigger policy outside these bounds could never actually be honored
// by the real queue once dispatch (INGR-7) wires this policy through.
const MIN_MAX_RECEIVE_COUNT = 1;
const MAX_MAX_RECEIVE_COUNT = 1_000;
const MIN_VISIBILITY_TIMEOUT_SECONDS = 0;
const MAX_VISIBILITY_TIMEOUT_SECONDS = 43_200; // SQS's own hard ceiling (12 hours)

const DEFAULT_MAX_RECEIVE_COUNT = 5;
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 120;

export function defaultDlqPolicy(): DlqPolicy {
  return {
    maxReceiveCount: DEFAULT_MAX_RECEIVE_COUNT,
    visibilityTimeoutSeconds: DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
  };
}

export function validateDlqPolicy(policy: unknown): DlqPolicy {
  const record = policy as {
    readonly maxReceiveCount?: unknown;
    readonly visibilityTimeoutSeconds?: unknown;
  } | null;

  if (record === null || typeof record !== "object") {
    throw new InvalidDlqPolicyError("policy must be an object");
  }

  const maxReceiveCount = record.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT;
  if (
    typeof maxReceiveCount !== "number" ||
    !Number.isInteger(maxReceiveCount) ||
    maxReceiveCount < MIN_MAX_RECEIVE_COUNT ||
    maxReceiveCount > MAX_MAX_RECEIVE_COUNT
  ) {
    throw new InvalidDlqPolicyError(
      `maxReceiveCount must be an integer between ${MIN_MAX_RECEIVE_COUNT} and ${MAX_MAX_RECEIVE_COUNT}`,
    );
  }

  const visibilityTimeoutSeconds =
    record.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;
  if (
    typeof visibilityTimeoutSeconds !== "number" ||
    !Number.isInteger(visibilityTimeoutSeconds) ||
    visibilityTimeoutSeconds < MIN_VISIBILITY_TIMEOUT_SECONDS ||
    visibilityTimeoutSeconds > MAX_VISIBILITY_TIMEOUT_SECONDS
  ) {
    throw new InvalidDlqPolicyError(
      `visibilityTimeoutSeconds must be an integer between ${MIN_VISIBILITY_TIMEOUT_SECONDS} and ${MAX_VISIBILITY_TIMEOUT_SECONDS}`,
    );
  }

  return { maxReceiveCount, visibilityTimeoutSeconds };
}
