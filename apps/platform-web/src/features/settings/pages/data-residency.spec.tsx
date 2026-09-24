import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/api/client"
import { ApiHttpError } from "@/api/http"
import type { TenantDataResidencySettings } from "@/api/types"
import { toast } from "sonner"

vi.mock("@/api/client", () => ({
  api: {
    getTenantDataResidencySettings: vi.fn(),
    updateTenantDataResidencySettings: vi.fn(),
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { DataResidencySettings } from "./data-residency"

const settings: TenantDataResidencySettings = {
  tenantId: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenantName: "Alter Labs",
  role: "owner",
  dataResidency: { allowed: ["eu", "de"], legalBasis: "GDPR Art. 44" },
  etag: '"v1"',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DataResidencySettings />
    </QueryClientProvider>,
  )
}

describe("Tenant data-residency settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getTenantDataResidencySettings).mockResolvedValue(settings)
    vi.mocked(api.updateTenantDataResidencySettings).mockResolvedValue(settings)
  })

  afterEach(cleanup)

  it("saves normalized residency codes and the legal basis against the loaded ETag", async () => {
    renderPage()

    const codes = await screen.findByLabelText("Allowed residency codes")
    expect((codes as HTMLInputElement).value).toBe("eu, de")
    await userEvent.clear(codes)
    await userEvent.type(codes, " in, SG, in ")
    const legalBasis = screen.getByLabelText("Legal basis")
    await userEvent.clear(legalBasis)
    await userEvent.type(legalBasis, "Customer contract")
    await userEvent.click(screen.getByRole("button", { name: "Save data residency" }))

    await waitFor(() =>
      expect(api.updateTenantDataResidencySettings).toHaveBeenCalledWith(
        settings.tenantId,
        { allowed: ["in", "SG"], legalBasis: "Customer contract" },
        settings.etag,
      ),
    )
  })

  it("sends null when the owner removes the residency pin", async () => {
    renderPage()

    await userEvent.click(await screen.findByLabelText("No residency pin"))
    await userEvent.click(screen.getByRole("button", { name: "Save data residency" }))

    await waitFor(() =>
      expect(api.updateTenantDataResidencySettings).toHaveBeenCalledWith(
        settings.tenantId,
        null,
        settings.etag,
      ),
    )
  })

  it("reloads the server value instead of overwriting after a stale write", async () => {
    const reloaded = {
      ...settings,
      dataResidency: { allowed: ["in"] },
      etag: '"v2"',
    }
    vi.mocked(api.getTenantDataResidencySettings)
      .mockResolvedValueOnce(settings)
      .mockResolvedValue(reloaded)
    vi.mocked(api.updateTenantDataResidencySettings).mockRejectedValue(
      new ApiHttpError({ code: "ETAG_MISMATCH", message: "changed" }, 412),
    )

    renderPage()
    const codes = await screen.findByLabelText("Allowed residency codes")
    await userEvent.clear(codes)
    await userEvent.type(codes, "us")
    await userEvent.click(screen.getByRole("button", { name: "Save data residency" }))

    await waitFor(() => expect(api.getTenantDataResidencySettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((codes as HTMLInputElement).value).toBe("in"))
    expect(toast.error).toHaveBeenCalledWith(
      "Data residency changed while you were editing. Reloaded the latest settings.",
    )
  })

  it("does not expose the editor to a tenant member", async () => {
    vi.mocked(api.getTenantDataResidencySettings).mockResolvedValue({
      ...settings,
      role: "member",
    })

    renderPage()

    expect(await screen.findByText("Access restricted")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save data residency" })).toBeNull()
  })
})
