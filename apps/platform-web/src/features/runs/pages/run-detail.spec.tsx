import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RunDetail } from "./run-detail"

const { stopRun, retryRun, runStore } = vi.hoisted(() => ({
  stopRun: vi.fn().mockResolvedValue(undefined),
  retryRun: vi.fn().mockResolvedValue({}),
  runStore: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    runStatus: "running",
    connectionStatus: "connected",
    terminalLines: [],
    selectedNodeId: undefined as string | undefined,
    clear: vi.fn(),
  },
}))

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ runId: "run_123" }),
}))

vi.mock("@/api/client", () => ({
  api: {
    getRun: vi.fn().mockResolvedValue({
      id: "run_123",
      status: "running",
      mode: "workflow",
      workflowId: "workflow_123",
      workflowName: "Release workflow",
      startedAt: new Date().toISOString(),
    }),
    stopRun,
    retryRun,
  },
}))

vi.mock("../stores/useRunStreamStore", () => ({
  useRunStreamStore: () => runStore,
}))

vi.mock("../components/run-timeline", () => ({ RunTimeline: () => <div /> }))
vi.mock("../components/run-inspector", () => ({ RunInspector: () => <div /> }))
vi.mock("../components/terminal-view", () => ({ TerminalView: () => <div /> }))
vi.mock("@/components/vectors/RunVector", () => ({ RunVector: () => <div /> }))

afterEach(() => {
  cleanup()
  stopRun.mockClear()
  retryRun.mockClear()
  runStore.runStatus = "running"
  runStore.selectedNodeId = undefined
})

describe("RunDetail", () => {
  it("requests cancellation when Stop Run is clicked", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    const view = render(
      <QueryClientProvider client={client}>
        <RunDetail />
      </QueryClientProvider>,
    )

    await user.click(await view.findByRole("button", { name: "Stop Run" }))

    await waitFor(() => expect(stopRun).toHaveBeenCalledWith("run_123"))
  })

  it("retries the selected node through the run action", async () => {
    runStore.runStatus = "failed"
    runStore.selectedNodeId = "failed_node"
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    const view = render(
      <QueryClientProvider client={client}>
        <RunDetail />
      </QueryClientProvider>,
    )

    await user.click(await view.findByRole("button", { name: "Retry Selected Node" }))

    await waitFor(() => expect(retryRun).toHaveBeenCalledWith("run_123", "failed_node"))
  })
})
