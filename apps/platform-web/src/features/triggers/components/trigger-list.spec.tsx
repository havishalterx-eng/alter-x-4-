import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/api/client"
import { toast } from "sonner"
import type { Trigger } from "@/api/types"
import { TriggerList } from "./trigger-list"

vi.mock("@/api/client", () => ({
  api: {
    getTriggers: vi.fn(),
    testTrigger: vi.fn(),
    removeTrigger: vi.fn(),
    enableTrigger: vi.fn(),
    disableTrigger: vi.fn(),
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const trigger: Trigger = {
  id: "trg_018f47a5-7b2c-7d10-8f11-123456789abc",
  workflowId: "wf_018f47a5-7b2c-7d10-8f11-123456789abc",
  type: "webhook",
  name: "Incoming order",
  enabled: true,
  status: "configured",
  config: {},
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TriggerList workflowId={trigger.workflowId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getTriggers).mockResolvedValue([trigger])
  vi.mocked(api.removeTrigger).mockResolvedValue(undefined)
  vi.mocked(api.testTrigger).mockResolvedValue({ success: true, message: "Test event recorded.", eventId: "evt_1" })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

describe("trigger controls", () => {
  it("archives only after confirmation and reports success after the API call", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    renderList()

    await userEvent.click(await screen.findByRole("button", { name: "Remove Incoming order" }))

    await waitFor(() => expect(api.removeTrigger).toHaveBeenCalledWith(trigger.id))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Trigger removed"))
  })

  it("leaves the trigger alone when removal is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false)
    renderList()

    await userEvent.click(await screen.findByRole("button", { name: "Remove Incoming order" }))

    expect(api.removeTrigger).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows a failed test request as an error", async () => {
    vi.mocked(api.testTrigger).mockRejectedValue(new Error("Test event could not be recorded"))
    renderList()

    await userEvent.click(await screen.findByRole("button", { name: "Test" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Test event could not be recorded"))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
