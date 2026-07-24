import { z } from "../../src/zod";

export {
  ActorTokenClaimsSchema,
  type ActorTokenClaims,
} from "../../src/actor-token";

export const ActorContextSchema = z
  .object({
    actor_type: z.enum(["user", "service"]),
    user_id: z.string().nullable(),
    tenant_id: z.string(),
    workspace_id: z.string().nullable(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    session_id: z.string().nullable(),
    jti: z.string().nullable(),
  })
  .strict();

export type ActorContext = z.infer<typeof ActorContextSchema>;
