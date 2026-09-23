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

import { apiGetWithEtag, apiPut } from "./http"
import { getWorkflowSafeguards, updateWorkflowSafeguards } from "./live"

const workflowId = "wf_019a1b2c-3d4e-7f50-8a61-72839405a6b1"
const response = {
  workspace: { contains_pii: true, approve_external_actions: true },
  additions: { customer_visible: false, contains_pii: false, approve_external_actions: true },
  effective: { customer_visible: false, contains_pii: true, approve_external_actions: true },
}

beforeEach(() => {
  vi.mocked(apiGetWithEtag).mockReset()
  vi.mocked(apiPut).mockReset()
  vi.mocked(apiGetWithEtag).mockResolvedValue({ data: response, etag: '"v1"' })
  vi.mocked(apiPut).mockResolvedValue(undefined)
})

describe("Workflow safeguards over the API", () => {
  it("reads the workspace rules, the workflow's additions and the ETag to save against", async () => {
    const safeguards = await getWorkflowSafeguards(workflowId)

    expect(vi.mocked(apiGetWithEtag).mock.calls[0]?.[0]).toBe(
      `/api/v1/workflows/${workflowId}/safeguards`,
    )
    expect(safeguards).toEqual({
      workspace: { containsPii: true, approveExternalActions: true },
      additions: { customerVisible: false, containsPii: false, approveExternalActions: true },
      effective: { customerVisible: false, containsPii: true, approveExternalActions: true },
      etag: '"v1"',
    })
  })

  it("sends the additions the route's shape expects, with If-Match", async () => {
    await updateWorkflowSafeguards(
      workflowId,
      { customerVisible: true, containsPii: false, approveExternalActions: true },
      '"v1"',
    )

    expect(vi.mocked(apiPut).mock.calls[0]).toEqual([
      `/api/v1/workflows/${workflowId}/safeguards`,
      {
        additions: {
          customer_visible: true,
          contains_pii: false,
          approve_external_actions: true,
        },
      },
      { ifMatch: '"v1"' },
    ])
    // The saved view is read back, so the caller sees what the server kept.
    expect(vi.mocked(apiGetWithEtag)).toHaveBeenCalledTimes(1)
  })
})
