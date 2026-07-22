import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import type { SecretsProvider } from "@alterx/shared-clients";

export interface SigningKeyResolver {
  resolvePrivateKey(keyRef: string): Promise<string>;
  resolvePublicKey(keyRef: string): Promise<string>;
}

export class SecretsProviderSigningKeyResolver implements SigningKeyResolver {
  private readonly privateKeys = new Map<string, string>();

  constructor(private readonly secretsProvider: SecretsProvider) {}

  async resolvePrivateKey(keyRef: string): Promise<string> {
    const cached = this.privateKeys.get(keyRef);
    if (cached) {
      return cached;
    }

    const privateKey = await this.secretsProvider.getSecret(keyRef);
    createPrivateKey(privateKey);
    this.privateKeys.set(keyRef, privateKey);
    return privateKey;
  }

  async resolvePublicKey(keyRef: string): Promise<string> {
    const privateKey = await this.resolvePrivateKey(keyRef);
    return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  }
}

export class GeneratedSigningKeyResolver implements SigningKeyResolver {
  private readonly keys = new Map<string, { privateKey: string; publicKey: string }>();

  async resolvePrivateKey(keyRef: string): Promise<string> {
    return this.getKeyPair(keyRef).privateKey;
  }

  async resolvePublicKey(keyRef: string): Promise<string> {
    return this.getKeyPair(keyRef).publicKey;
  }

  private getKeyPair(keyRef: string): { privateKey: string; publicKey: string } {
    const existing = this.keys.get(keyRef);
    if (existing) {
      return existing;
    }

    const generated = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    this.keys.set(keyRef, generated);
    return generated;
  }
}

export class StaticSigningKeyResolver implements SigningKeyResolver {
  constructor(
    private readonly privateKey: string,
    private readonly publicKey: string,
  ) {}

  async resolvePrivateKey(_keyRef: string): Promise<string> {
    void _keyRef;
    return this.privateKey;
  }

  async resolvePublicKey(_keyRef: string): Promise<string> {
    void _keyRef;
    return this.publicKey;
  }
}
