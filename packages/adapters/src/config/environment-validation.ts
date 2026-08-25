export type ConfigurationErrorFactory = (field: string, reason: string) => Error;

export interface EnvironmentValidators {
  requireValue(environment: NodeJS.ProcessEnv, field: string): string;
  parsePort(value: string | undefined, field?: string, defaultPort?: number): number;
  parseRequiredPort(value: string, field: string): number;
  parseGrpcAddress(
    value: string | undefined,
    field: string,
    defaultAddress: string,
    validatePort?: boolean,
  ): string;
}

/**
 * Shared, service-neutral environment parsing.  Services provide their own
 * error factory so validation remains behaviorally identical at each public
 * configuration boundary.
 */
export function createEnvironmentValidators(
  createError: ConfigurationErrorFactory,
): EnvironmentValidators {
  const invalidPort = (field: string): Error =>
    createError(field, "must be an integer from 1 to 65535");

  return {
    requireValue(environment, field): string {
      const value = environment[field]?.trim();
      if (value === undefined || value.length === 0) {
        throw createError(field, "a non-empty value is required");
      }
      return value;
    },
    parsePort(value, field = "PORT", defaultPort = 3000): number {
      if (value === undefined) {
        return defaultPort;
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw invalidPort(field);
      }
      return port;
    },
    parseRequiredPort(value, field): number {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw invalidPort(field);
      }
      return port;
    },
    parseGrpcAddress(value, field, defaultAddress, validatePort = true): string {
      const address = value?.trim() ?? defaultAddress;
      if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
        throw createError(field, "must be an IPv4 address and port");
      }
      const port = Number(address.slice(address.lastIndexOf(":") + 1));
      if (validatePort && (port < 1 || port > 65_535)) {
        throw createError(field, "port must be from 1 to 65535");
      }
      return address;
    },
  };
}
