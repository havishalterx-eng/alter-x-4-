import { afterEach, describe, expect, it } from "vitest";
import { resolveEmailProvider } from "./notification.module";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("resolveEmailProvider", () => {
  it("defaults to the mock provider outside production", () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.NODE_ENV;
    expect(resolveEmailProvider().metadata.providerId).toBe("mock-email");
  });

  it("refuses to serve mock email when NODE_ENV=production", () => {
    delete process.env.EMAIL_PROVIDER;
    process.env.NODE_ENV = "production";
    expect(() => resolveEmailProvider()).toThrow(
      "EMAIL_PROVIDER=mock is not allowed when NODE_ENV=production",
    );
  });

  it("fails closed instead of silently falling back to mock when EMAIL_PROVIDER=ses is missing credentials", () => {
    process.env.EMAIL_PROVIDER = "ses";
    delete process.env.SES_FROM_ADDRESS;
    delete process.env.SES_CREDENTIALS_SECRET_REF;
    expect(() => resolveEmailProvider()).toThrow(
      "SES_FROM_ADDRESS and SES_CREDENTIALS_SECRET_REF are required when EMAIL_PROVIDER=ses",
    );
  });

  it("builds the real SES provider when explicitly selected with credentials", () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.SES_FROM_ADDRESS = "no-reply@alter.test";
    process.env.SES_CREDENTIALS_SECRET_REF = "env:SES_CREDENTIALS";
    const provider = resolveEmailProvider();
    expect(provider.metadata.providerId).toBe("aws-ses");
  });
});
