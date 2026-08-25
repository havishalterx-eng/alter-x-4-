import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { api } from "@/api/client"
import { CredentialDialog } from "./credential-dialog"

vi.mock("@/api/client", () => ({
  api: {
    createCredential: vi.fn(),
  },
}))

const createCredential = vi.mocked(api.createCredential)

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <CredentialDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return onOpenChange
}

async function fillCredential() {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText("e.g., Production DB Password"), "Production DB")
  await user.type(screen.getByPlaceholderText("e.g., postgres"), "postgres")
  await user.type(screen.getByPlaceholderText("e.g., production"), "production")
  await user.type(screen.getByPlaceholderText("Paste secret here..."), "super-secret")
  await user.click(screen.getByRole("button", { name: "Save to Vault" }))
}

describe("CredentialDialog", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("submits the entered secret to the credential API and closes only after success", async () => {
    createCredential.mockResolvedValue({
      id: "credential-id",
      name: "Production DB",
      type: "secret",
      provider: "postgres",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      usedByConnectionIds: [],
    })
    const onOpenChange = renderDialog()

    await fillCredential()

    await waitFor(() => expect(createCredential).toHaveBeenCalledWith({
      name: "Production DB",
      connector: "postgres",
      scope: "production",
      value: "super-secret",
    }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("keeps the dialog open and shows an error when the API save fails", async () => {
    createCredential.mockRejectedValue(new Error("Credential save failed"))
    const onOpenChange = renderDialog()

    await fillCredential()

    expect((await screen.findByRole("alert")).textContent).toContain("Credential save failed")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
