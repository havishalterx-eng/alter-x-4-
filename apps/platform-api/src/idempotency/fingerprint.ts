import { createHash } from "node:crypto";

export function requestFingerprint(
  method: string,
  path: string,
  body: unknown,
): string {
  const canonical = JSON.stringify({
    method: method.toUpperCase(),
    path,
    body: canonicalize(body),
  });
  return createHash("sha256").update(canonical).digest("hex");
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
