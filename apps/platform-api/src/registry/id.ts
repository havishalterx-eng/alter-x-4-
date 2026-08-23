import { v7 as uuidv7 } from "uuid";
// ENGINE-FIX-PHASE2-N1: registry validation.ts's `id` regex (used by
// parseVersionId for scan/revoke) demands a literal UUIDv7 version nibble
// -- node:crypto's randomUUID() only ever mints v4, which made every
// version id this function produced permanently unrecognizable to its own
// validator. v7 also matches every other canonical id scheme in this repo
// (see workspaces.service.ts), which already uses the same `uuid` package.
export function registryId(prefix: "tlm" | "tlv" | "scn" | "rvk"): string { return `${prefix}_${uuidv7()}`; }
