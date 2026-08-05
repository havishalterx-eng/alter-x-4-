import { Injectable } from "@nestjs/common";
import type { DeviceAuthorization, DeviceTokenResult, IdentityProvider } from "../identity/identity-provider.interface";
import type { CliConfigProvider } from "./cli-config";

export type CliVersionStatus = "current" | "outdated" | "unsupported";

@Injectable()
export class CliService {
  constructor(
    private readonly identity: IdentityProvider,
    private readonly config: CliConfigProvider,
  ) {}

  authorize(): Promise<DeviceAuthorization> {
    return this.identity.startDeviceAuthorization();
  }

  poll(deviceCode: string): Promise<DeviceTokenResult> {
    return this.identity.pollDeviceToken(deviceCode);
  }

  async doctor(cliVersion: string | undefined) {
    const policy = await this.config.getCliPolicy();
    return {
      platform_api_version: process.env.PLATFORM_API_VERSION ?? "unknown",
      minimum_cli_version: policy.minimumCliVersion,
      your_cli_version_status: cliVersionStatus(cliVersion, policy.minimumCliVersion),
    };
  }
}

export function cliVersionStatus(
  cliVersion: string | undefined,
  minimumVersion: string,
): CliVersionStatus {
  const actual = parseVersion(cliVersion);
  const minimum = parseVersion(minimumVersion);
  if (!actual || !minimum || actual.major < minimum.major) return "unsupported";
  if (compareVersion(actual, minimum) < 0) return "outdated";
  return "current";
}

function parseVersion(value: string | undefined) {
  const match = value?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersion(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number },
): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
