import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IdentityBrokerService } from "./identity-broker.service";
import { verifyActorToken } from "./jwt";
import { EnvironmentSecretsProvider } from "./secrets-provider";
import {
  GeneratedSigningKeyResolver,
  SecretsProviderSigningKeyResolver,
  StaticSigningKeyResolver,
} from "./signing-key-resolver";

const tenantId = "00000000-0000-7000-8000-000000000001";

describe("SecretsProvider signing keys", () => {
  it("verifies a pre-restart token from a new instance using the same resolved key", async () => {
    const keys = keyPair();
    const reference = "env:ACTOR_TOKEN_PRIVATE_KEY";
    const firstResolver = new SecretsProviderSigningKeyResolver(
      new EnvironmentSecretsProvider({
        ACTOR_TOKEN_PRIVATE_KEY: keys.privateKey.replaceAll("\n", "\\n"),
      }),
    );
    const firstInstance = new IdentityBrokerService(reference, firstResolver, () => 1_785_000_000);
    const mintedBeforeRestart = await firstInstance.mintActorToken({
      userId: "00000000-0000-7000-8000-000000000201",
      tenantId,
      workspaceId: "00000000-0000-7000-8000-000000000101",
      sessionId: "00000000-0000-7000-8000-000000000301",
      authTime: 1_784_999_900,
      roles: ["owner"],
      permissions: [],
      callingTenantId: tenantId,
    });

    const restartedResolver = new SecretsProviderSigningKeyResolver(
      new EnvironmentSecretsProvider({ ACTOR_TOKEN_PRIVATE_KEY: keys.privateKey }),
    );
    const restartedInstance = new IdentityBrokerService(
      reference,
      restartedResolver,
      () => 1_785_000_001,
    );
    await restartedInstance.mintServiceActorToken({
      serviceName: "restart-check",
      tenantId,
      callingTenantId: tenantId,
    });

    const publicKeyAfterRestart = await restartedResolver.resolvePublicKey(reference);
    expect(verifyActorToken(mintedBeforeRestart.token, publicKeyAfterRestart)).toBe(true);
    await expect(firstResolver.resolvePrivateKey(reference)).resolves.toBe(keys.privateKey);
    await expect(firstResolver.resolvePrivateKey(reference)).resolves.toBe(keys.privateKey);
  });

  it("rejects unsupported and unavailable environment references", async () => {
    const provider = new EnvironmentSecretsProvider({});
    await expect(provider.getSecret("aws:secret/key")).rejects.toThrow(
      "Unsupported secret reference",
    );
    await expect(provider.getSecret("env:MISSING_KEY")).rejects.toThrow(
      "Secret reference unavailable",
    );
    await expect(provider.getSecret("env:")).rejects.toThrow("Secret reference unavailable");
  });

  it("keeps generated and static resolvers limited to explicit callers", async () => {
    const generated = new GeneratedSigningKeyResolver();
    const firstPrivate = await generated.resolvePrivateKey("test-key");
    const firstPublic = await generated.resolvePublicKey("test-key");
    expect(verifyActorToken("invalid", firstPublic)).toBe(false);
    await expect(generated.resolvePrivateKey("test-key")).resolves.toBe(firstPrivate);

    const staticResolver = new StaticSigningKeyResolver(firstPrivate, firstPublic);
    await expect(staticResolver.resolvePrivateKey("ignored")).resolves.toBe(firstPrivate);
    await expect(staticResolver.resolvePublicKey("ignored")).resolves.toBe(firstPublic);
  });
});

function keyPair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
