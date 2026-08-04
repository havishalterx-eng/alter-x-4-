import { randomUUID } from "node:crypto";

export function publisherId(prefix: "pub" | "kyc" | "pay" | "led"): string {
  return `${prefix}_${randomUUID()}`;
}
