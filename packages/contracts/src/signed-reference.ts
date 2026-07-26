// Generic shape for any endpoint that must hand back a time-bounded
// reference to sensitive content instead of the content itself or a
// permanent public URL -- the same pattern this codebase already uses for
// secrets (SecretsProvider references, never raw values). First user:
// /conversations/{id}/actions/handoff, which previously returned an
// opaque Resource (a real data-exposure risk for a security-sensitive
// export). Reusable later for artifact downloads / deletion certificates
// without redefining this shape each time.
import { z } from "./zod";
import { IsoTimestampSchema } from "./ids";

export const SignedReferenceSchema = z
  .object({
    signed_url: z.string().url(),
    expires_at: IsoTimestampSchema,
  })
  .strict();

export type SignedReference = z.infer<typeof SignedReferenceSchema>;
