import { z } from "./zod";

export const AdsPermissionSubjectSchema = z.string().min(1);

export const AdsDocumentPermissionsSchema = z
  .object({
    visibility: z.literal("tenant"),
    shared_with: z.array(AdsPermissionSubjectSchema),
  })
  .strict()
  .openapi("AdsDocumentPermissions");

export const AdsDocumentPermissionsPatchSchema = z
  .object({
    visibility: z.literal("tenant").optional(),
    shared_with: z.array(AdsPermissionSubjectSchema).optional(),
  })
  .strict()
  .openapi("AdsDocumentPermissionsPatch");

export const AdsSourcePermissionsSchema = AdsDocumentPermissionsSchema.extend({
  retention_days: z.number().int().min(1).max(3650).nullable().optional(),
})
  .strict()
  .openapi("AdsSourcePermissions");

export type AdsDocumentPermissions = z.infer<
  typeof AdsDocumentPermissionsSchema
>;
export type AdsDocumentPermissionsPatch = z.infer<
  typeof AdsDocumentPermissionsPatchSchema
>;
export type AdsSourcePermissions = z.infer<typeof AdsSourcePermissionsSchema>;
