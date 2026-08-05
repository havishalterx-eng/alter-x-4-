import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ENTITLEMENT_PROVIDER, type EntitlementProvider } from "../entitlements/entitlement-provider.interface";
import { AdminTenantsRepository } from "./admin-tenants.repository";
import { AdminTenantHttpError } from "./problem";
import type {
  AdminTenantDetailView,
  AdminTenantView,
  EntitlementOverrideInput,
  ProvisionTenantInput,
  SuspendTenantInput,
} from "./types";

const DEFAULT_REGION = "ap-south-1";

@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly repository: AdminTenantsRepository,
    @Inject(ENTITLEMENT_PROVIDER)
    private readonly entitlements: EntitlementProvider,
  ) {}

  async provision(
    staffUserId: string,
    input: ProvisionTenantInput,
  ): Promise<AdminTenantView> {
    const id = randomUUID();
    const tenant = await this.repository.createTenant(
      id,
      input.name,
      input.identity_org_ref,
      input.region ?? DEFAULT_REGION,
    );
    await this.entitlements.createEntitlement(id, input.plan, undefined, {
      accessState: "active",
    });
    await this.repository.recordAction(id, staffUserId, "provisioned", null);
    return tenant;
  }

  async list(): Promise<AdminTenantView[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<AdminTenantDetailView> {
    const instance = `/api/v1/admin/tenants/${id}`;
    const tenant = await this.requireTenant(id, instance);
    const effective = await this.entitlements.getEffectiveEntitlement(id);
    return {
      ...tenant,
      entitlement: {
        plan: effective.plan,
        access_state: effective.accessState,
        limits: effective.limits,
      },
    };
  }

  async suspend(
    id: string,
    staffUserId: string,
    input: SuspendTenantInput,
  ): Promise<AdminTenantView> {
    const instance = `/api/v1/admin/tenants/${id}/actions/suspend`;
    await this.requireTenant(id, instance);
    const updated = await this.repository.setStatus(id, "suspended");
    if (!updated) throw notFound(instance);
    const effective = await this.entitlements.getEffectiveEntitlement(id);
    await this.entitlements.createEntitlement(id, effective.plan, undefined, {
      accessState: "suspended",
      limits: effective.limits,
    });
    await this.repository.recordAction(id, staffUserId, "suspended", input.reason);
    return updated;
  }

  async reinstate(id: string, staffUserId: string): Promise<AdminTenantView> {
    const instance = `/api/v1/admin/tenants/${id}/actions/reinstate`;
    await this.requireTenant(id, instance);
    const updated = await this.repository.setStatus(id, "active");
    if (!updated) throw notFound(instance);
    const effective = await this.entitlements.getEffectiveEntitlement(id);
    await this.entitlements.createEntitlement(id, effective.plan, undefined, {
      accessState: "active",
      limits: effective.limits,
    });
    await this.repository.recordAction(id, staffUserId, "reinstated", null);
    return updated;
  }

  async overrideEntitlement(
    id: string,
    staffUserId: string,
    input: EntitlementOverrideInput,
  ): Promise<AdminTenantDetailView> {
    const instance = `/api/v1/admin/tenants/${id}/entitlements`;
    const tenant = await this.requireTenant(id, instance);
    const current = await this.entitlements.getEffectiveEntitlement(id);
    const updated = await this.entitlements.createEntitlement(
      id,
      input.plan ?? current.plan,
      undefined,
      {
        accessState: current.accessState,
        limits: { ...current.limits, ...(input.limits ?? {}) },
      },
    );
    await this.repository.recordAction(
      id,
      staffUserId,
      "entitlement_overridden",
      input.reason,
    );
    return {
      ...tenant,
      entitlement: {
        plan: updated.plan,
        access_state: updated.accessState,
        limits: updated.limits,
      },
    };
  }

  private async requireTenant(
    id: string,
    instance: string,
  ): Promise<AdminTenantView> {
    const tenant = await this.repository.find(id);
    if (!tenant) throw notFound(instance);
    return tenant;
  }
}

function notFound(instance: string): AdminTenantHttpError {
  return new AdminTenantHttpError(
    404,
    "ADMIN_TENANT_NOT_FOUND",
    "Tenant not found",
    instance,
  );
}
