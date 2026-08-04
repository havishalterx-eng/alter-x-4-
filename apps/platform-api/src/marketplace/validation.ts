import { ENTITLEMENT_LIMIT_KEYS } from "../entitlements/types";
import { MarketplaceHttpError } from "./problem";
import {
  licenseTypes,
  listingStatuses,
  listingTypes,
  type CreateListingInput,
  type CreateListingVersionInput,
  type CreateReviewInput,
  type InstallListingInput,
  type ListingCompatibility,
  type ListingQuery,
  type UpdateListingInput,
} from "./types";
import { z } from "zod";

const idPattern = /^[a-z]{3}_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const semverPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const compatibilitySchema = z
  .object({
    dagSchemaVersion: z.string().min(1).max(100),
    nodeTypes: z.array(z.string().min(1).max(255)).max(500),
    connectorCapabilities: z.array(z.string().min(1).max(255)).max(500),
    requiredEntitlements: z.array(z.enum(ENTITLEMENT_LIMIT_KEYS)).max(7),
  })
  .strict();
const createListingSchema = z
  .object({
    type: z.enum(listingTypes),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(10_000).optional(),
    license_type: z.enum(licenseTypes),
  })
  .strict();
const updateListingSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).max(10_000).nullable().optional(),
    license_type: z.enum(licenseTypes).optional(),
    status: z.enum(listingStatuses).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field required");
const createVersionSchema = z
  .object({
    version: z.string().regex(semverPattern, "Expected semantic version"),
    payload_ref: z.string().min(1).max(2_048),
    compatibility: compatibilitySchema,
  })
  .strict();
const installSchema = z.object({
  listing_version_id: z.string().regex(idPattern, "Expected prefixed UUIDv7"),
  confirmed: z.literal(true),
}).strict();
const createReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(5_000).optional(),
  })
  .strict();

export function parseCreateListing(input: unknown, instance: string): CreateListingInput {
  const value = parse(createListingSchema, input, instance);
  return { type: value.type, name: value.name, license_type: value.license_type, ...(value.description === undefined ? {} : { description: value.description }) };
}

export function parseUpdateListing(input: unknown, instance: string): UpdateListingInput {
  const value = parse(updateListingSchema, input, instance);
  return { ...(value.name === undefined ? {} : { name: value.name }), ...(value.description === undefined ? {} : { description: value.description }), ...(value.license_type === undefined ? {} : { license_type: value.license_type }), ...(value.status === undefined ? {} : { status: value.status }) };
}

export function parseCreateListingVersion(
  input: unknown,
  instance: string,
): CreateListingVersionInput {
  const parsed = parse(createVersionSchema, input, instance);
  const unknown = parsed.compatibility.requiredEntitlements.find(
    (key) => !ENTITLEMENT_LIMIT_KEYS.includes(key),
  );
  if (unknown) {
    throw new MarketplaceHttpError(
      400,
      "MARKETPLACE_UNKNOWN_ENTITLEMENT",
      "Listing compatibility contains an unknown entitlement.",
      instance,
      [{ field: "compatibility.requiredEntitlements", message: unknown }],
    );
  }
  return parsed;
}

export function parseInstallListing(input: unknown, instance: string): InstallListingInput {
  return parse(installSchema, input, instance);
}

export function parseInstalledPayloadRef(value: string, instance: string): string {
  if (value.trim().length === 0) {
    throw invalid(instance, [{ field: "installed_payload_ref", message: "Expected copied payload reference" }]);
  }
  return value;
}

export function parseCompatibilityCheck(
  input: unknown,
  instance: string,
): { listing_version_id: string } {
  return parse(
    z.object({ listing_version_id: z.string().regex(idPattern, "Expected prefixed UUIDv7") }).strict(),
    input,
    instance,
  );
}

export function parseCreateReview(input: unknown, instance: string): CreateReviewInput {
  const value = parse(createReviewSchema, input, instance);
  return { rating: value.rating, ...(value.comment === undefined ? {} : { comment: value.comment }) };
}

export function parseListingId(value: string, instance: string): string {
  if (!/^lst_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw invalid(instance, [{ field: "listingId", message: "Expected listing UUIDv7" }]);
  }
  return value;
}

export function parseListingQuery(
  query: Record<string, string | undefined>,
  instance: string,
): ListingQuery {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw invalid(instance, [{ field: "limit", message: "Expected positive integer" }]);
  }
  const type = query.type === undefined ? undefined : z.enum(listingTypes).safeParse(query.type);
  const status = query.status === undefined ? undefined : z.enum(listingStatuses).safeParse(query.status);
  if (type && !type.success) throw invalid(instance, [{ field: "type", message: "Invalid listing type" }]);
  if (status && !status.success) throw invalid(instance, [{ field: "status", message: "Invalid listing status" }]);
  return {
    ...(type ? { type: type.data } : {}),
    ...(status ? { status: status.data } : {}),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    limit: Math.min(limit, 200),
  };
}

export function isListingCompatibility(value: unknown): value is ListingCompatibility {
  return compatibilitySchema.safeParse(value).success;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, instance: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const unknownEntitlement = result.error.issues.find(
    (issue) => issue.path[0] === "compatibility" && issue.path[1] === "requiredEntitlements" && issue.code === "invalid_value",
  );
  if (unknownEntitlement) {
    throw new MarketplaceHttpError(
      400,
      "MARKETPLACE_UNKNOWN_ENTITLEMENT",
      "Listing compatibility contains an unknown entitlement.",
      instance,
      [{ field: unknownEntitlement.path.join("."), message: unknownEntitlement.message }],
    );
  }
  throw invalid(
    instance,
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    })),
  );
}

function invalid(
  instance: string,
  fieldErrors: NonNullable<ConstructorParameters<typeof MarketplaceHttpError>[4]>,
): MarketplaceHttpError {
  return new MarketplaceHttpError(
    400,
    "INVALID_MARKETPLACE_REQUEST",
    "Marketplace request validation failed",
    instance,
    fieldErrors,
  );
}
