import { createHash } from "node:crypto";

export function computeEtag(
  resource: unknown,
  version?: string | number,
): string {
  const source =
    version === undefined
      ? stableJson(resource)
      : `version:${String(version)}`;
  return `"${createHash("sha256").update(source).digest("base64url")}"`;
}

export function ifMatchIncludes(ifMatch: string, currentEtag: string): boolean {
  return ifMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === currentEtag);
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  return serialized ?? "undefined";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
