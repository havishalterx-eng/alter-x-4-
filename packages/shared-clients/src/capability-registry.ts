import {
  ProviderCapabilitiesSchema,
  type ProviderCapabilities,
} from "@alterx/contracts";

export type ProviderRequirements = Partial<ProviderCapabilities>;

type ParsedProviderRequirements = {
  [Key in keyof ProviderCapabilities]?:
    | ProviderCapabilities[Key]
    | undefined;
};

export interface CapabilityValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class CapabilityRegistrationError extends Error {
  public readonly providerId: string;
  public readonly issues: readonly CapabilityValidationIssue[];

  public constructor(
    providerId: string,
    message: string,
    issues: readonly CapabilityValidationIssue[] = [],
  ) {
    super(message);
    this.name = "CapabilityRegistrationError";
    this.providerId = providerId;
    this.issues = issues;
  }
}

export class CapabilityRequirementsError extends Error {
  public readonly issues: readonly CapabilityValidationIssue[];

  public constructor(issues: readonly CapabilityValidationIssue[]) {
    super("Provider capability requirements are malformed");
    this.name = "CapabilityRequirementsError";
    this.issues = issues;
  }
}

const ProviderRequirementsSchema = ProviderCapabilitiesSchema.partial();
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;

function validationIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): readonly CapabilityValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function freezeCapabilities(
  capabilities: ProviderCapabilities,
): ProviderCapabilities {
  for (const rate of capabilities.cost_model.rates) {
    Object.freeze(rate);
  }

  Object.freeze(capabilities.cost_model.rates);
  Object.freeze(capabilities.cost_model);
  Object.freeze(capabilities.regional_availability);
  Object.freeze(capabilities.data_residency);
  Object.freeze(capabilities.supported_languages);
  return Object.freeze(capabilities);
}

function includesAll(
  available: readonly string[],
  required: readonly string[],
): boolean {
  return required.every((value) => available.includes(value));
}

function satisfiesCostModel(
  available: ProviderCapabilities["cost_model"],
  required: ProviderCapabilities["cost_model"],
): boolean {
  return required.rates.every((requiredRate) =>
    available.rates.some(
      (availableRate) =>
        availableRate.unit === requiredRate.unit &&
        availableRate.currency_code === requiredRate.currency_code &&
        availableRate.amount <= requiredRate.amount,
    ),
  );
}

function satisfies(
  available: ProviderCapabilities,
  required: ParsedProviderRequirements,
): boolean {
  return (
    (required.streaming === undefined ||
      available.streaming === required.streaming) &&
    (required.tool_calling === undefined ||
      available.tool_calling === required.tool_calling) &&
    (required.vision === undefined || available.vision === required.vision) &&
    (required.structured_output === undefined ||
      available.structured_output === required.structured_output) &&
    (required.long_context === undefined ||
      available.long_context === required.long_context) &&
    (required.batch_support === undefined ||
      available.batch_support === required.batch_support) &&
    (required.maximum_payload === undefined ||
      available.maximum_payload >= required.maximum_payload) &&
    (required.regional_availability === undefined ||
      includesAll(
        available.regional_availability,
        required.regional_availability,
      )) &&
    (required.data_residency === undefined ||
      includesAll(available.data_residency, required.data_residency)) &&
    (required.supported_languages === undefined ||
      includesAll(
        available.supported_languages,
        required.supported_languages,
      )) &&
    (required.cost_model === undefined ||
      satisfiesCostModel(available.cost_model, required.cost_model))
  );
}

export class CapabilityRegistry {
  readonly #providers = new Map<string, ProviderCapabilities>();

  public register(
    providerId: string,
    capabilities: ProviderCapabilities,
  ): void {
    if (
      providerId.length === 0 ||
      providerId.trim() !== providerId ||
      !PROVIDER_ID_PATTERN.test(providerId)
    ) {
      throw new CapabilityRegistrationError(
        providerId,
        "Provider ID must be a non-empty, stable identifier",
      );
    }

    const parsed = ProviderCapabilitiesSchema.safeParse(capabilities);
    if (!parsed.success) {
      throw new CapabilityRegistrationError(
        providerId,
        "Provider capability declaration is malformed",
        validationIssues(parsed.error.issues),
      );
    }

    this.#providers.set(providerId, freezeCapabilities(parsed.data));
  }

  public resolve(requirements: ProviderRequirements): string[] {
    const parsed = ProviderRequirementsSchema.safeParse(requirements);
    if (!parsed.success) {
      throw new CapabilityRequirementsError(
        validationIssues(parsed.error.issues),
      );
    }

    return [...this.#providers.entries()]
      .filter(([, capabilities]) => satisfies(capabilities, parsed.data))
      .map(([providerId]) => providerId);
  }

  public get(providerId: string): ProviderCapabilities | undefined {
    return this.#providers.get(providerId);
  }
}
