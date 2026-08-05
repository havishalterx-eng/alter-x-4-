import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { RbacModule } from "../rbac";
import { PLAN_DEFINITION_STORE } from "../entitlements/plan-definition-store";
import { AdminPolicyModule } from "./admin-policy.module";
import { AdminPolicyService } from "./admin-policy.service";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("AdminPolicyModule", () => {
  it("wires real providers and applies staff auth middleware on init", async () => {
    process.env.DATABASE_URL = "postgres://localhost/platform";

    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule, AdminPolicyModule],
    }).compile();

    expect(moduleRef.get(AdminPolicyService)).toBeInstanceOf(AdminPolicyService);
    expect(moduleRef.get(PLAN_DEFINITION_STORE, { strict: false })).toBeDefined();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.close();
  });
});
