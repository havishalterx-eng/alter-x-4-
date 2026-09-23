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

import { apiGet, apiGetWithEtag, apiPatch, apiPost } from "./http"
import { disableTrigger, getTriggers, removeTrigger, testTrigger } from "./live"

const triggerId = "trg_018f47a5-7b2c-7d10-8f11-123456789abc"
const workflowId = "wf_018f47a5-7b2c-7d10-8f11-123456789abc"
const trigger = {
  id: triggerId,
  workflowId,
  name: "Daily digest",
  type: "cron",
  status: "enabled",
  provider: null,
}

beforeEach(() => {
  vi.mocked(apiGet).mockReset()
  vi.mocked(apiGetWithEtag).mockReset()
  vi.mocked(apiPatch).mockReset()
  vi.mocked(apiPost).mockReset()
  vi.mocked(apiGetWithEtag).mockResolvedValue({ data: trigger, etag: '"trigger-v1"' })
  vi.mocked(apiPatch).mockResolvedValue({ ...trigger, status: "archived" })
})

describe("live trigger management", () => {
  it("shows current triggers with the engine's status and type mapped for the UI", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      triggers: [trigger, { ...trigger, id: "trg_archived", status: "archived" }],
    })

    expect(await getTriggers(workflowId)).toMatchObject([
      { id: triggerId, type: "schedule", status: "configured", enabled: true },
    ])
  })

  it("reports a test only after the backend returns a recorded event", async () => {
    vi.mocked(apiPost).mockResolvedValue({ eventId: "evt_123", triggerId, triggerVersion: 2 })

    expect(await testTrigger(triggerId)).toEqual({
      success: true,
      message: "Test event recorded.",
      eventId: "evt_123",
    })
    expect(apiPost).toHaveBeenCalledWith(
      `/api/v1/triggers/${triggerId}/actions/test`,
      {},
      { idempotencyKey: "trigger-test-test-key" },
    )
  })

  it("does not claim success when the test response has no event id", async () => {
    vi.mocked(apiPost).mockResolvedValue({})
    await expect(testTrigger(triggerId)).rejects.toThrow("No test event was returned")
  })

  it("archives a trigger through the real status route with the server ETag", async () => {
    await removeTrigger(triggerId)

    expect(apiGetWithEtag).toHaveBeenCalledWith(`/api/v1/triggers/${triggerId}`)
    expect(apiPatch).toHaveBeenCalledWith(
      `/api/v1/triggers/${triggerId}/status`,
      { status: "archived" },
      { idempotencyKey: "trigger-status-test-key", ifMatch: '"trigger-v1"' },
    )
  })

  it("refuses a status change without the server ETag", async () => {
    vi.mocked(apiGetWithEtag).mockResolvedValue({ data: trigger, etag: undefined })

    await expect(removeTrigger(triggerId)).rejects.toThrow("Trigger ETag missing")
    expect(apiPatch).not.toHaveBeenCalled()
  })

  it("disables a trigger using the same real status route", async () => {
    vi.mocked(apiPatch).mockResolvedValue({ ...trigger, status: "disabled" })

    expect(await disableTrigger(triggerId)).toMatchObject({ enabled: false, status: "configured" })
    expect(apiPatch).toHaveBeenCalledWith(
      `/api/v1/triggers/${triggerId}/status`,
      { status: "disabled" },
      { idempotencyKey: "trigger-status-test-key", ifMatch: '"trigger-v1"' },
    )
  })
})
