import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./http", () => ({
  apiGet: vi.fn(),
  apiGetWithEtag: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  mutationKey: (prefix: string) => `${prefix}-test-key`,
}))

import { apiGet, apiGetWithEtag, apiPut } from "./http"
import {
  getTenantDataResidencySettings,
  updateTenantDataResidencySettings,
} from "./live"

const tenant = {
  id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  name: "Alter Labs",
  status: "active",
  region: "ap-south-1",
  role: "owner",
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset()
  vi.mocked(apiGetWithEtag).mockReset()
  vi.mocked(apiPut).mockReset()
  vi.mocked(apiGet).mockResolvedValue([tenant])
  vi.mocked(apiGetWithEtag).mockResolvedValue({
    data: { data_residency: { allowed: ["eu", "de"], legal_basis: "GDPR Art. 44" } },
    etag: '"v1"',
  })
  vi.mocked(apiPut).mockResolvedValue(undefined)
})

describe("Tenant data-residency settings over the API", () => {
  it("loads the caller's tenant, residency value and server ETag", async () => {
    await expect(getTenantDataResidencySettings()).resolves.toEqual({
      tenantId: tenant.id,
      tenantName: tenant.name,
      role: "owner",
      dataResidency: { allowed: ["eu", "de"], legalBasis: "GDPR Art. 44" },
      etag: '"v1"',
    })

    expect(apiGet).toHaveBeenCalledWith("/api/v1/tenants")
    expect(apiGetWithEtag).toHaveBeenCalledWith(
      `/api/v1/tenants/${tenant.id}/data-residency`,
    )
  })

  it("saves a pinned residency with If-Match and returns the refreshed view", async () => {
    await updateTenantDataResidencySettings(
      tenant.id,
      { allowed: ["in", "sg"], legalBasis: "Customer contract" },
      '"v1"',
    )

    expect(vi.mocked(apiPut).mock.calls[0]).toEqual([
      `/api/v1/tenants/${tenant.id}/data-residency`,
      {
        data_residency: {
          allowed: ["in", "sg"],
          legal_basis: "Customer contract",
        },
      },
      { ifMatch: '"v1"' },
    ])
    expect(apiGetWithEtag).toHaveBeenCalledTimes(1)
  })

  it("sends null to remove a tenant residency pin", async () => {
    await updateTenantDataResidencySettings(tenant.id, null, '"v1"')

    expect(vi.mocked(apiPut).mock.calls[0]?.[1]).toEqual({ data_residency: null })
  })

  it("refuses to write without the ETag returned by the server", async () => {
    await expect(
      updateTenantDataResidencySettings(tenant.id, null, undefined),
    ).rejects.toThrow("Tenant data residency ETag missing")
    expect(apiPut).not.toHaveBeenCalled()
  })

  it("fails closed when the stored residency shape is malformed", async () => {
    vi.mocked(apiGetWithEtag).mockResolvedValue({
      data: { data_residency: { allowed: [] } },
      etag: '"v1"',
    })

    await expect(getTenantDataResidencySettings()).rejects.toThrow(
      "Tenant data residency response is malformed",
    )
  })
})
