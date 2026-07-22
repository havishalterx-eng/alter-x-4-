import { z } from "./zod";
import {
  NonEmptyStringSchema,
  ServiceActorIdSchema,
  TenantIdSchema,
  UserIdSchema,
  WorkspaceIdSchema,
} from "./ids";

const NumericDateSchema = z.number().int().nonnegative();

export const ActorTokenClaimsSchema = z
  .object({
    user_id: z.union([UserIdSchema, ServiceActorIdSchema]),
    tenant_id: TenantIdSchema,
    workspace_id: WorkspaceIdSchema,
    roles: z.array(NonEmptyStringSchema),
    permissions: z.array(NonEmptyStringSchema),
    session_id: NonEmptyStringSchema,
    auth_time: NumericDateSchema,
    jti: NonEmptyStringSchema,
    iss: NonEmptyStringSchema,
    aud: NonEmptyStringSchema,
    iat: NumericDateSchema,
    exp: NumericDateSchema,
  })
  .strict()
  .superRefine(({ auth_time, iat, exp }, context) => {
    if (auth_time > iat) {
      context.addIssue({
        code: "custom",
        message: "auth_time must not be later than iat",
        path: ["auth_time"],
      });
    }

    if (exp <= iat || exp - iat > 300) {
      context.addIssue({
        code: "custom",
        message: "Actor token lifetime must be positive and no more than 300 seconds",
        path: ["exp"],
      });
    }
  })
  .describe(
    "Alter-owned signed delegation JWT claims. Never include secrets or model M2M bearer-token claims.",
  );

export type ActorTokenClaims = z.infer<typeof ActorTokenClaimsSchema>;
