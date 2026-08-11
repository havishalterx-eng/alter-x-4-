import { Metadata } from "@grpc/grpc-js";

/** Caller-side contract; token acquisition stays in the auth package. */
export interface ServiceAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export async function serviceAuthorizationMetadata(
  provider: ServiceAccessTokenProvider | undefined,
): Promise<Metadata> {
  const metadata = new Metadata();
  if (provider === undefined) return metadata;
  const token = (await provider.getAccessToken()).trim();
  if (!token) throw new Error("M2M access-token provider returned an empty token");
  metadata.set("authorization", `Bearer ${token}`);
  return metadata;
}
