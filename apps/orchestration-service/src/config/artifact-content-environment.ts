export interface ArtifactContentEnvironment { readonly grpcBindAddress: string; }
export class ArtifactContentConfigurationError extends Error { constructor(reason: string) { super(`Invalid Artifact Content Service environment: ${reason}`); this.name = "ArtifactContentConfigurationError"; } }
export function loadArtifactContentEnvironment(environment: NodeJS.ProcessEnv): ArtifactContentEnvironment {
  const grpcBindAddress = environment.ARTIFACT_CONTENT_GRPC_BIND_ADDRESS?.trim() ?? "0.0.0.0:50061";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(grpcBindAddress)) throw new ArtifactContentConfigurationError("ARTIFACT_CONTENT_GRPC_BIND_ADDRESS must be an IPv4 address and port");
  const port = Number(grpcBindAddress.slice(grpcBindAddress.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) throw new ArtifactContentConfigurationError("ARTIFACT_CONTENT_GRPC_BIND_ADDRESS port must be from 1 to 65535");
  return { grpcBindAddress };
}
