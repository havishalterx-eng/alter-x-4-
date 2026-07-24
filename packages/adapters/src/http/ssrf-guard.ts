const BLOCKED_IPV4_RANGES: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return undefined;
    }
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === undefined) {
    return true; // Unparseable IPv4-shaped literal: fail closed.
  }
  return BLOCKED_IPV4_RANGES.some(([base, prefixLength]) => {
    const baseValue = ipv4ToInt(base);
    if (baseValue === undefined) {
      return false;
    }
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function isBlockedIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase();
  if (ip === "::1" || ip === "::") {
    return true;
  }
  if (ip.startsWith("fe80:") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) {
    return true; // fc00::/7 unique local
  }
  if (ip.startsWith("ff")) {
    return true; // ff00::/8 multicast
  }
  const dottedMapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMapped?.[1] !== undefined) {
    return isBlockedIpv4(dottedMapped[1]);
  }
  // Node's URL parser normalizes IPv4-mapped IPv6 literals to hex-group form
  // (e.g. ::ffff:127.0.0.1 becomes ::ffff:7f00:1), not the dotted-decimal
  // form above. Both forms must be checked or this is an SSRF bypass.
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped?.[1] !== undefined && hexMapped[2] !== undefined) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    const dotted = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
    return isBlockedIpv4(dotted);
  }
  return false;
}

export function isBlockedIpLiteral(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isBlockedIpv4(ip) : isBlockedIpv6(ip);
}

export interface SsrfGuardPolicy {
  readonly allowedSchemes?: readonly string[];
}

const DEFAULT_ALLOWED_SCHEMES: readonly string[] = ["https:"];

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export function assertUrlSchemeAllowed(
  url: URL,
  policy: SsrfGuardPolicy = {},
): void {
  const allowed = policy.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!allowed.includes(url.protocol)) {
    throw new SsrfBlockedError(
      `URL scheme ${url.protocol} is not permitted; allowed schemes: ${allowed.join(", ")}`,
    );
  }
}

export function assertHostnameNotLiteralBlockedIp(hostname: string): void {
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bareHost)) {
    if (isBlockedIpv4(bareHost)) {
      throw new SsrfBlockedError(
        `URL host ${bareHost} resolves to a blocked private/internal IPv4 address`,
      );
    }
    return;
  }
  if (bareHost.includes(":")) {
    if (isBlockedIpv6(bareHost)) {
      throw new SsrfBlockedError(
        `URL host ${bareHost} resolves to a blocked private/internal IPv6 address`,
      );
    }
  }
}

export function assertResolvedAddressesNotBlocked(
  addresses: readonly { readonly address: string; readonly family: 4 | 6 }[],
): void {
  for (const { address, family } of addresses) {
    if (isBlockedIpLiteral(address, family)) {
      throw new SsrfBlockedError(
        `Resolved address ${address} is a blocked private/internal IP`,
      );
    }
  }
}
