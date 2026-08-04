import { randomUUID } from "node:crypto";
export function registryId(prefix: "tlm" | "tlv" | "scn" | "rvk"): string { return `${prefix}_${randomUUID()}`; }
