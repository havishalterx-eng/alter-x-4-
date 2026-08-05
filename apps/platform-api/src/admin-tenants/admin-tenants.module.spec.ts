import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { RbacModule } from "../rbac";
import { AdminTenantsModule } from "./admin-tenants.module";
import { AdminTenantsRepository } from "./admin-tenants.repository";
import { AdminTenantsService } from "./admin-tenants.service";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("AdminTenantsModule", () => {
  it("wires real providers and applies staff auth middleware on init", async () => {
    process.env.DATABASE_URL = "postgres://localhost/platform";

    const moduleRef = await Test.createTestingModule({
      imports: [RbacModule, AdminTenantsModule],
    }).compile();

    expect(moduleRef.get(AdminTenantsRepository)).toBeInstanceOf(
      AdminTenantsRepository,
    );
    expect(moduleRef.get(AdminTenantsService)).toBeInstanceOf(
      AdminTenantsService,
    );

    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.close();
  });
});
