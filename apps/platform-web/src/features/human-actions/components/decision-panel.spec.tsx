import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { HumanAction } from "@/api/types"
import { useAuth } from "@/features/auth/hooks/useAuth"
import { DecisionPanel } from "./decision-panel"

// Who holds a claimed action decides who may act on it. This used to compare
// against a hard-coded "usr_1", so the panel answered the same way for every
// signed-in person.
const claimant = "019a1b2c-3d4e-7f50-8a61-72839405a6b1"
const someoneElse = "019a1b2c-3d4e-7f50-8a61-72839405a6b2"

const action: HumanAction = {
  id: "esc_019a1b2c-3d4e-7f50-8a61-72839405a6b3",
  type: "escalation",
  status: "claimed",
  priority: "normal",
  title: "Escalation",
  workspaceId: "ws",
  runId: "run",
  nodeName: "node",
  createdAt: "2026-09-23T00:00:00.000Z",
  claimedBy: { id: claimant, name: "Claimant" },
}

function panel(currentUserId: string | undefined) {
  useAuth.setState({
    user:
      currentUserId === undefined
        ? null
        : { userId: currentUserId, tenantId: "ten", email: "a@example.com", name: "A" },
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DecisionPanel action={action} />
    </QueryClientProvider>,
  )
}

describe("DecisionPanel on an action somebody has claimed", () => {
  beforeEach(() => useAuth.setState({ user: null }))
  // No global auto-cleanup in this config: each render must be torn down, or
  // the next query sees both.
  afterEach(cleanup)

  it("lets the person who claimed it act, whichever user that is", () => {
    panel(claimant)

    expect(screen.queryByText("Action Locked")).toBeNull()
  })

  it("accepts the session's prefixed id for the same person", () => {
    panel(`usr_${claimant}`)

    expect(screen.queryByText("Action Locked")).toBeNull()
  })

  it("locks the action for anybody else", () => {
    panel(someoneElse)

    expect(screen.queryByText("Action Locked")).not.toBeNull()
  })

  it("locks it while the session is still unknown, rather than assuming it is yours", () => {
    panel(undefined)

    expect(screen.queryByText("Action Locked")).not.toBeNull()
  })
})
