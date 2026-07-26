import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import type { ActorContextType, RbacRequest } from "../rbac";
import { CredentialEtagResolver } from "./credential-etag.resolver";
import { CredentialService } from "./credential.service";

const actor: ActorContextType = {
  user_id: "018f47a5-7b2c-7d10-8f11-123456789abd",
  tenant_id: "018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session",
  roles: ["admin"],
  permissions: ["credential:write"],
};

describe("CredentialEtagResolver", () => {
  it("resolves actor credential version", async () => {
    const body = {
      id: "018f47a5-7b2c-7d10-8f11-123456789abe",
      name: "DB",
      connector: "postgres",
      scope: "deploy",
      last4: "****1234",
      created_at: "2026-07-26T10:00:00.000Z",
      version: "2026-07-26T10:00:00.000Z",
    };
    const get = vi.fn(async () => body);
    const resolver = new CredentialEtagResolver({
      get,
    } as unknown as CredentialService);
    const request = {
      actorContext: actor,
      params: { id: body.id },
      url: `/api/v1/credentials/${body.id}?x=1`,
    } as unknown as FastifyRequest & RbacRequest;
    await expect(resolver.resolve(request)).resolves.toEqual({
      resource: body,
      version: body.version,
    });
  });

  it("default-denies missing actor or id", async () => {
    const resolver = new CredentialEtagResolver({
      get: vi.fn(),
    } as unknown as CredentialService);
    await expect(
      resolver.resolve({
        url: "",
        params: {},
      } as unknown as FastifyRequest),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      resolver.resolve({
        url: "/api/v1/credentials/id",
        actorContext: actor,
        params: {},
      } as unknown as FastifyRequest & RbacRequest),
    ).rejects.toMatchObject({ status: 400 });
  });
});
