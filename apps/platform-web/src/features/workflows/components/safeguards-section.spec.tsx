import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "@/api/client"
import { ApiHttpError } from "@/api/http"
import type { WorkflowSafeguards } from "@/api/types"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SafeguardsSection } from "./safeguards-section"

const workflowId = "wf_019a1b2c-3d4e-7f50-8a61-72839405a6b1"

function view(overrides: Partial<WorkflowSafeguards> = {}): WorkflowSafeguards {
  return {
    workspace: { containsPii: true, approveExternalActions: true },
    additions: { customerVisible: false, containsPii: false, approveExternalActions: false },
    effective: { customerVisible: false, containsPii: true, approveExternalActions: true },
    etag: '"v1"',
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SafeguardsSection workflowId={workflowId} />
    </QueryClientProvider>,
  )
}

describe("Safeguards on the review screen", () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(cleanup)

  it("shows a rule the workspace requires as on, and does not let it be turned off", async () => {
    vi.spyOn(api, "getWorkflowSafeguards").mockResolvedValue(view())

    renderSection()

    const workspaceRule = await screen.findByLabelText("Approve external actions")
    expect((workspaceRule as HTMLInputElement).checked).toBe(true)
    expect((workspaceRule as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText("Required by this workspace")).toHaveLength(2)
  })

  it("saves an addition with the ETag the view was read at", async () => {
    vi.spyOn(api, "getWorkflowSafeguards").mockResolvedValue(view())
    const update = vi
      .spyOn(api, "updateWorkflowSafeguards")
      .mockResolvedValue(
        view({ additions: { customerVisible: true, containsPii: false, approveExternalActions: false } }),
      )

    renderSection()
    await userEvent.click(await screen.findByLabelText("Output goes to a customer"))
    await userEvent.click(screen.getByRole("button", { name: "Save safeguards" }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        workflowId,
        { customerVisible: true, containsPii: false, approveExternalActions: false },
        '"v1"',
      ),
    )
  })

  it("reloads instead of overwriting when the safeguards changed while editing", async () => {
    const changed = view({
      workspace: { containsPii: true, approveExternalActions: true },
      additions: { customerVisible: false, containsPii: false, approveExternalActions: true },
      etag: '"v2"',
    })
    const read = vi
      .spyOn(api, "getWorkflowSafeguards")
      .mockResolvedValueOnce(view())
      .mockResolvedValue(changed)
    vi.spyOn(api, "updateWorkflowSafeguards").mockRejectedValue(
      new ApiHttpError(
        { code: "ETAG_MISMATCH", message: "changed" } as never,
        412,
      ),
    )

    renderSection()
    await userEvent.click(await screen.findByLabelText("Output goes to a customer"))
    await userEvent.click(screen.getByRole("button", { name: "Save safeguards" }))

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect((screen.getByLabelText("Output goes to a customer") as HTMLInputElement).checked).toBe(
        false,
      ),
    )
  })
})
