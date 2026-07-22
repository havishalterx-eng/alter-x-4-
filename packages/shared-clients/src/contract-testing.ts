import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { BaseProvider } from "./provider-types";

export interface ProviderContractCase<TProvider extends BaseProvider> {
  readonly name: string;
  readonly assert: (provider: TProvider) => unknown | Promise<unknown>;
}

export interface ProviderContractSuite<TProvider extends BaseProvider> {
  readonly name: string;
  readonly cases: readonly ProviderContractCase<TProvider>[];
}

export interface ProviderContractRedactionContext {
  readonly suiteName: string;
  readonly caseName: string;
  readonly implementationName: string;
  readonly channel: "observation" | "error";
}

export type ProviderContractRedactor = (
  value: unknown,
  context: ProviderContractRedactionContext,
) => unknown;

export interface ProviderContractRunnerOptions {
  readonly redact?: ProviderContractRedactor;
}

export interface ProviderContractImplementation<TProvider extends BaseProvider> {
  readonly name: string;
  readonly create: () => TProvider | Promise<TProvider>;
}

export interface ProviderContractResult {
  readonly implementationName: string;
  readonly caseName: string;
  readonly passed: boolean;
  readonly outcome: ProviderContractOutcome;
  readonly error: unknown | undefined;
}

export type NormalizedContractValue =
  | boolean
  | number
  | string
  | null
  | readonly NormalizedContractValue[]
  | NormalizedContractObject;

export interface NormalizedContractObject {
  readonly [key: string]: NormalizedContractValue;
}

export interface NormalizedContractError {
  readonly name: string;
  readonly message: string;
  readonly details: NormalizedContractValue;
}

export type ProviderContractOutcome =
  | {
      readonly status: "fulfilled";
      readonly value: NormalizedContractValue;
    }
  | {
      readonly status: "rejected";
      readonly error: NormalizedContractError;
    };

export interface ProviderContractReport {
  readonly suiteName: string;
  readonly passed: boolean;
  readonly results: readonly ProviderContractResult[];
}

export class ProviderContractConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProviderContractConfigurationError";
  }
}

export class ProviderContractViolationError extends Error {
  public readonly report: ProviderContractReport;

  public constructor(report: ProviderContractReport) {
    const failures = report.results.filter((result) => !result.passed);
    super(
      `Provider contract ${report.suiteName} failed ${failures.length} assertion(s)`,
    );
    this.name = "ProviderContractViolationError";
    this.report = report;
  }
}

export class ProviderContractParityError extends Error {
  public readonly baselineImplementationName: string;
  public readonly implementationName: string;
  public readonly caseName: string;
  public readonly baselineOutcome: ProviderContractOutcome;
  public readonly actualOutcome: ProviderContractOutcome;

  public constructor(options: {
    readonly baselineImplementationName: string;
    readonly implementationName: string;
    readonly caseName: string;
    readonly baselineOutcome: ProviderContractOutcome;
    readonly actualOutcome: ProviderContractOutcome;
  }) {
    super(
      `Provider contract parity diverged for ${options.caseName}: ` +
        `${options.implementationName} differs from ${options.baselineImplementationName}`,
    );
    this.name = "ProviderContractParityError";
    this.baselineImplementationName = options.baselineImplementationName;
    this.implementationName = options.implementationName;
    this.caseName = options.caseName;
    this.baselineOutcome = options.baselineOutcome;
    this.actualOutcome = options.actualOutcome;
  }
}

function normalizeContractValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): NormalizedContractValue {
  if (value === undefined) {
    return { $type: "undefined" };
  }

  if (
    value === null ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : { $type: "number", value: String(value) };
  }

  if (typeof value === "bigint") {
    return { $type: "bigint", value: value.toString() };
  }

  if (typeof value === "symbol" || typeof value === "function") {
    throw new ProviderContractConfigurationError(
      "Provider contract outcomes must contain serializable values",
    );
  }

  if (ancestors.has(value)) {
    throw new ProviderContractConfigurationError(
      "Provider contract outcomes must be acyclic",
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (value instanceof Date) {
    return { $type: "date", value: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeContractValue(item, nextAncestors));
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProviderContractConfigurationError(
      "Provider contract outcomes must use plain objects",
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ProviderContractConfigurationError(
      "Provider contract outcomes must not contain symbol keys",
    );
  }

  const normalized: Record<string, NormalizedContractValue> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[redactString(key)] = normalizeContractValue(
      (value as Record<string, unknown>)[key],
      nextAncestors,
    );
  }
  return normalized;
}

function redactString(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `[redacted:sha256:${digest}:length:${value.length}]`;
}

function normalizeContractError(error: unknown): NormalizedContractError {
  if (error instanceof Error) {
    return {
      name: redactString(error.name),
      message: redactString(error.message),
      details: normalizeContractValue(
        Object.fromEntries(
          Object.keys(error)
            .sort()
            .map((key) => [
              key,
              (error as unknown as Record<string, unknown>)[key],
            ]),
        ),
      ),
    };
  }

  return {
    name: redactString("NonErrorThrow"),
    message: redactString(String(error)),
    details: normalizeContractValue(error),
  };
}

async function executeContractCase<TProvider extends BaseProvider>(
  contractCase: ProviderContractCase<TProvider>,
  implementation: ProviderContractImplementation<TProvider>,
  suiteName: string,
  options: ProviderContractRunnerOptions,
): Promise<{
  readonly outcome: ProviderContractOutcome;
  readonly error: NormalizedContractError | undefined;
}> {
  try {
    const provider = await implementation.create();
    const value = await contractCase.assert(provider);
    const redactedValue =
      options.redact === undefined
        ? value
        : options.redact(value, {
            suiteName,
            caseName: contractCase.name,
            implementationName: implementation.name,
            channel: "observation",
          });
    return {
      outcome: {
        status: "fulfilled",
        value: normalizeContractValue(redactedValue),
      },
      error: undefined,
    };
  } catch (error) {
    const redactedError =
      options.redact === undefined
        ? error
        : options.redact(error, {
            suiteName,
            caseName: contractCase.name,
            implementationName: implementation.name,
            channel: "error",
          });
    const normalizedError = normalizeContractError(redactedError);
    return {
      outcome: {
        status: "rejected",
        error: normalizedError,
      },
      error: normalizedError,
    };
  }
}

export async function runProviderContractTests<TProvider extends BaseProvider>(
  suite: ProviderContractSuite<TProvider>,
  implementations: readonly ProviderContractImplementation<TProvider>[],
  options: ProviderContractRunnerOptions = {},
): Promise<ProviderContractReport> {
  if (suite.cases.length === 0) {
    throw new ProviderContractConfigurationError(
      "A provider contract suite must contain at least one case",
    );
  }

  if (implementations.length < 2) {
    throw new ProviderContractConfigurationError(
      "Provider parity requires at least two implementations",
    );
  }

  const results: ProviderContractResult[] = [];

  const baselineImplementation = implementations[0];
  if (baselineImplementation === undefined) {
    throw new ProviderContractConfigurationError(
      "Provider parity requires a baseline implementation",
    );
  }

  for (const contractCase of suite.cases) {
    let baselineOutcome: ProviderContractOutcome | undefined;

    for (const implementation of implementations) {
      const execution = await executeContractCase(
        contractCase,
        implementation,
        suite.name,
        options,
      );
      baselineOutcome ??= execution.outcome;

      const matchesBaseline = isDeepStrictEqual(
        execution.outcome,
        baselineOutcome,
      );
      const parityError = matchesBaseline
        ? undefined
        : new ProviderContractParityError({
            baselineImplementationName: baselineImplementation.name,
            implementationName: implementation.name,
            caseName: contractCase.name,
            baselineOutcome,
            actualOutcome: execution.outcome,
          });

      results.push({
        implementationName: implementation.name,
        caseName: contractCase.name,
        passed:
          execution.outcome.status === "fulfilled" && matchesBaseline,
        outcome: execution.outcome,
        error: parityError ?? execution.error,
      });
    }
  }

  return Object.freeze({
    suiteName: suite.name,
    passed: results.every((result) => result.passed),
    results: Object.freeze(results),
  });
}

export async function assertProviderContractParity<
  TProvider extends BaseProvider,
>(
  suite: ProviderContractSuite<TProvider>,
  implementations: readonly ProviderContractImplementation<TProvider>[],
  options: ProviderContractRunnerOptions = {},
): Promise<ProviderContractReport> {
  const report = await runProviderContractTests(
    suite,
    implementations,
    options,
  );
  if (!report.passed) {
    throw new ProviderContractViolationError(report);
  }

  return report;
}
