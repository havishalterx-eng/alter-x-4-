export function secretLast4(value: string): string {
  return value.slice(-4);
}

export function maskSecretLast4(last4: string): string {
  return `****${last4}`;
}
